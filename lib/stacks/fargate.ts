import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {Aspects, Duration, Stack} from "aws-cdk-lib";
import {
    Cluster,
    CpuArchitecture, EcrImage, FargateService,
    FargateTaskDefinition, IBaseService,
    LogDrivers,
    OperatingSystemFamily
} from "aws-cdk-lib/aws-ecs";

import {IVpc, Peer, Port, SecurityGroup} from "aws-cdk-lib/aws-ec2";

import {
    ApplicationProtocol,
    ApplicationProtocolVersion
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import {Effect, PolicyStatement} from "aws-cdk-lib/aws-iam";
import { CfnProxyCredentials, Domain, VwsIngressV2} from "@vw-sre/vws-cdk";
import {Certificate, CertificateValidation} from "aws-cdk-lib/aws-certificatemanager";
import {ApplicationTargetGroup} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import {Microservice} from "../interfaces/microservice-interface";
import {EnableObjectOwnership} from "../shared/bucket-aspect";
import {IRepository} from "aws-cdk-lib/aws-ecr";



interface FargateProps {
    taskDesiredCount: number;
    containerName: string,
    stackProps: cdk.StackProps,
    stage: string,
    taskDefinition: {
        cpu: number,
        memoryLimitMiB: number,
    },
    vpc: IVpc,
    ecrRepo:IRepository,
    profile: string
}

export class CustomFargate extends Stack {
    fargateService: IBaseService

    constructor(scope: Construct, microservice: Microservice, proxyCredentials: CfnProxyCredentials, props: FargateProps) {
        
        //----------VARIABLES
        const stage = props.stage;
        const containerName = props.containerName;
        const clusterName = `${microservice.name}-${stage}-cluster`;
        const loadBalancerSecurityGroupName = `${microservice.name}-${stage}-security-group-load-balancer`;
        const targetGroupName = `${microservice.name}-${stage}-tcp-service`;
        const taskDefName = `${microservice.name}-${stage}-fargate-task-definition`;
        const securityGroupFargate = `${microservice.name}-${stage}-sg`;
        const logDriverTask = `${microservice.name}-${stage}-log-group`;
        const fargateServiceName = `${microservice.name}-${stage}-fargate-service`;
        const applicationLbName = `${microservice.name}-${stage}-alb`;
        const vpc = props.vpc
        //----------VARIABLES
        
        props.stackProps = {
            ...props.stackProps,
            stackName: `${stage.toUpperCase()}${microservice.name}FargateStack`
        }

        super(scope, props.stackProps.stackName, props.stackProps);
        
        //----------TaskDefinition
        const taskDefinition = new FargateTaskDefinition(
            this,
            taskDefName,
            {
                cpu: props.taskDefinition.cpu,
                memoryLimitMiB: props.taskDefinition.memoryLimitMiB,
                runtimePlatform: {
                    cpuArchitecture: CpuArchitecture.X86_64,
                    operatingSystemFamily: OperatingSystemFamily.LINUX,
                },
            }
        );
        taskDefinition.addToExecutionRolePolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                'ecr:*', 'kms:*', 'secretsmanager:*'
            ],
            resources: ['*'],
        }))
        taskDefinition.addToTaskRolePolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                'ecr:*', 'kms:*', 'secretsmanager:*'
            ],
            resources: ['*'],
        }))
        //----------TaskDefinition


        //----------Container
        const secretManager = cdk.aws_secretsmanager.Secret.fromSecretNameV2(this,'Secret' , microservice.secretManagerName+'/'+stage);
        const proxySecretManager = cdk.aws_secretsmanager.Secret.fromSecretCompleteArn(this, 'ProxySecret', proxyCredentials.secretsArn);
        const noProxy = '*amazonaws.com,vwapps.run,vwapps.io,vwgroup.io,vwgroup.com,vwg-connect.com,volkswagenag.com,cariad.cloud,cariad.digital'


        const container = taskDefinition.addContainer(containerName, {
                containerName: containerName,
                image: EcrImage.fromEcrRepository(props.ecrRepo),
                logging: LogDrivers.awsLogs({streamPrefix: logDriverTask, logRetention: 30}),
                environment: {
                    PROXY_URL: 'proxy.resources.vwapps.cloud',
                    NO_PROXY: noProxy,
                    PROXY_PORT: '8080',
                    PROXY_PORT_HTTPS: '8080',
                    PROXY_PORT_HTTP: '8080',
                    PROFILE: props.profile,
                    NEW_RELIC_APP_NAME: 'pde-auth-'+props.profile
                },
                secrets: {
                    PROXY_USER: cdk.aws_ecs.Secret.fromSecretsManager(proxySecretManager, 'username'),
                    PROXY_PASSWORD: cdk.aws_ecs.Secret.fromSecretsManager(proxySecretManager, 'password'),
                    IDKIT_CLIENT_SECRET: cdk.aws_ecs.Secret.fromSecretsManager(secretManager, 'IDKIT_CLIENT_SECRET'),
                    NEW_RELIC_LICENSE_KEY: cdk.aws_ecs.Secret.fromSecretsManager(secretManager, 'NEW_RELIC_LICENSE_KEY')
                }}
        );
        container.addPortMappings({
            containerPort: 9091,
            hostPort: 9091
        });
        container.addPortMappings({
            containerPort: 5005,
            hostPort: 5005
        });
        //----------Container

        //----------SecurityGroups
        const securityGroup = new SecurityGroup(this, securityGroupFargate, {
            securityGroupName: securityGroupFargate,
            vpc
        });
        const albSg = new SecurityGroup(this, loadBalancerSecurityGroupName, {
            securityGroupName: loadBalancerSecurityGroupName,
            vpc,
            allowAllOutbound: true,
        });
        securityGroup.addIngressRule(
            Peer.securityGroupId(albSg.securityGroupId),
            Port.tcp(9091),
            'Allow inbound connections from ALB'
        );
        securityGroup.addIngressRule(
            Peer.securityGroupId(albSg.securityGroupId),
            Port.tcp(5005),
            'Allow inbound connections from ALB'
        );
        //----------SecurityGroups

        //----------Fargate itself
        const cluster = new Cluster(this, clusterName, {
            clusterName: clusterName,
            vpc,
            containerInsights: true,
        });
        const fargateService = new FargateService(this, fargateServiceName, {
            serviceName: fargateServiceName,
            cluster: cluster,
            assignPublicIp: false,
            taskDefinition,
            securityGroups: [securityGroup],
            desiredCount: props.taskDesiredCount,
        })
        this.fargateService = fargateService
        //----------Fargate itself

        //----------Load balancer
        const domain = new Domain(this, 'Domain', {
            domain: `${microservice.name.toLowerCase()}-${stage}`,
        });

        const certificate = new Certificate(this, 'Certificate', {
            domainName: domain.name,
            validation: CertificateValidation.fromDns(domain.hostedZone),
        });

        const targetGroup = new ApplicationTargetGroup(this, applicationLbName, {
            vpc,
            targetGroupName,
            port: container.containerPort,
            protocol: ApplicationProtocol.HTTP,
            protocolVersion: ApplicationProtocolVersion.HTTP1,
            healthCheck: {
                interval: Duration.seconds(150),
                path: '/actuator/health',
                port: '9091'
            },
        });

        const ingress = new VwsIngressV2(this, 'Ingress', {
            vpc,
            domain,
            certificates: [certificate],
            targetGroup: {
                targetGroup,
                includeLogin: false,
            },
            logRetention: Duration.days(3),
            loadBalancerIdleTimeout: Duration.seconds(30),
        });

        ingress.securityGroup.addIngressRule(
            Peer.securityGroupId(albSg.securityGroupId),
            Port.tcp(80),
            'Allow inbound connections from ALB'
        )
        ingress.securityGroup.addIngressRule(
            Peer.securityGroupId(albSg.securityGroupId),
            Port.tcp(443),
            'Allow inbound connections from ALB'
        )

        Aspects.of(ingress).add(new EnableObjectOwnership());
        targetGroup.addTarget(fargateService)
        //----------Load balancer
    }
}