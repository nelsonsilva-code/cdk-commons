import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {aws_ecs, Duration, SecretValue} from "aws-cdk-lib";
import {
    CfnCluster,
    Cluster, ContainerDefinition,
    CpuArchitecture, EcrImage, FargateService,
    FargateTaskDefinition,
    LogDrivers,
    OperatingSystemFamily,

} from "aws-cdk-lib/aws-ecs";
import {IVpc, Peer, Port, SecurityGroup} from "aws-cdk-lib/aws-ec2";
import {Effect, PolicyStatement, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import {CfnProxyCredentials} from "@vw-sre/vws-cdk";
import {AlarmsInterface, Microservice} from "../interfaces";
import {IRepository} from "aws-cdk-lib/aws-ecr";
import {StringParameter} from 'aws-cdk-lib/aws-ssm';
import {DatabaseInstance, IDatabaseCluster} from "aws-cdk-lib/aws-rds";
import * as sm from "aws-cdk-lib/aws-secretsmanager";
import {ApplicationProfile, EnvironmentStage} from "../interfaces";
import {DnsRecordType, PrivateDnsNamespace} from "aws-cdk-lib/aws-servicediscovery";
import {Key} from "aws-cdk-lib/aws-kms";
import {Alarm, ComparisonOperator, TreatMissingData} from "aws-cdk-lib/aws-cloudwatch";
import {Topic} from "aws-cdk-lib/aws-sns";
import {SnsAction} from "aws-cdk-lib/aws-cloudwatch-actions";

interface CustomFargateProps {
    taskDesiredCount: number;
    containerName: string;
    /**
     * Stage (AKA Environment) to be used by application. Pinned to 4 types.
     */
    stage: EnvironmentStage['stage'];
    /**
     * @see {@link https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html#task_size}
     */
    taskDefinition: {
        cpu: number,
        memoryLimitMiB: number,
    };
    vpc: IVpc;
    /**
     * ECR Repository that contains images created by the project's code pipeline, that will be used by the fargate instances.
     */
    ecrRepo:IRepository;
    /**
     * Application profile to be used by application. This varies from environment to environment, but is pinned to 4 types.
     */
    profile: ApplicationProfile['profile'];
    /**
     * Several microservice details/configs
     */
    microservice: Microservice;
    healthCheck: {
        interval: Duration,
        path: string,
        port: string,
    };
    portMappings: number[];
    /**
     * Any additional environment variables that need to be passed on to Fargate (e.g. SQS ARN, Bucket ARN, etc.)
     */
    fargateEnvironmentVariables?: {[p: string]: string};
    /**
     * Any additional secrets from SM that need to be passed on to Fargate (e.g. Secret ARN for user credentials)
     */
    fargateAdditionalSecrets?:  {[p: string]: aws_ecs.Secret};
    /**
     * Secret values to be added to fargate secret (e.g: Application Token needed for specific microservice)
     */
    secretObjectValues?: {[key: string]: SecretValue}
    env: {account: string, region: string};
    /**
     * Allows for internal connections using DNS calls through cloudmap
     * */
    allowInternalConnections: boolean,
    /**
     * Allows for internal connection (.internal domains) using cloudmap.
     */
    fargateClusterName: string,
    fargateServiceName: string,
    fargateCpuArchitecture: CpuArchitecture,
    fargateOSFamily: OperatingSystemFamily,
    enableExecuteCommand?: boolean,
    rootReadOnly?: boolean;
    /**
     * Proxy credentials passed as CfnProxyCredentials.
     */
    proxyCredentials: CfnProxyCredentials,
    /**
     * Simple string with entries that SHOULD NOT go through the proxy (e.g.: amazonaws.com,vwapps.run).
     */
    noProxySuffixes?: string
}

export default class CustomFargate extends Construct {
    public fargateService: FargateService

    public taskDefinition: FargateTaskDefinition

    public container: ContainerDefinition

    public microservice: Microservice

    public stage: string

    public fargateSecurityGroup: SecurityGroup

    public externalSecurityGroup?: SecurityGroup

    public loadbalancerSecurityGroup?: SecurityGroup

    public healthCheck: {interval: Duration, path: string, port: string}

    public vpc: IVpc
    constructor(scope: Construct, id: string, props: CustomFargateProps) {
        super(scope, id);

        //----------VARIABLES
        const stage = props.stage.toLowerCase();
        const containerName = props.containerName;
        const fargateClusterName = props.fargateClusterName;
        const logDriverTask = `${props.microservice.name}-${stage}-log-group`;
        const fargateServiceName = props.fargateServiceName;

        this.vpc = props.vpc
        this.microservice = props.microservice
        this.stage = stage
        this.healthCheck = props.healthCheck
        //----------VARIABLES

        //----------TaskDefinition
        const taskDefinition = new FargateTaskDefinition(
            this,
            'TaskDefinition',
            {
                cpu: props.taskDefinition.cpu,
                memoryLimitMiB: props.taskDefinition.memoryLimitMiB,
                runtimePlatform: {
                    cpuArchitecture: props.fargateCpuArchitecture,
                    operatingSystemFamily: props.fargateOSFamily,
                },
                volumes: [{ name: 'tmp'}],
                ephemeralStorageGiB: 21,
            }
        );

        this.taskDefinition = taskDefinition;

        taskDefinition.addToExecutionRolePolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                'ecr:*', 'kms:*', 'secretsmanager:*','sqs:*','ses:*'
            ],
            resources: ['*'],
        }))
        taskDefinition.addToTaskRolePolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                'ecr:*', 'kms:*', 'secretsmanager:*','sqs:*','ses:*'
            ],
            resources: ['*'],
        }))
        //----------TaskDefinition

        //----------Container
        const encryptionKey = new Key(this, 'KmsKey', {
            alias: `${props.microservice.name}-${props.stage}-secrets`,
            description: 'Kms key for microservices env secrets',
            enableKeyRotation: true,
            pendingWindow: Duration.days(7),
        });

        let secrets: {[p: string]: cdk.aws_ecs.Secret} = {};
        Object.assign(secrets, props.fargateAdditionalSecrets);

        if (props.secretObjectValues) {
            const secretManager = new sm.Secret(this, `${props.microservice.name}${props.stage}Secrets`, {
                secretName: `${props.microservice.name}/${props.stage}/ecs-env`,
                description: `${props.stage} secrets for ${props.microservice.name}`,
                encryptionKey,
                secretObjectValue: {...props.secretObjectValues}
            });

            secrets = Object.entries(props.secretObjectValues!).reduce((acc, [key]) => {
                acc[key] = cdk.aws_ecs.Secret.fromSecretsManager(secretManager, key);
                return acc;
            }, {} as { [key: string]: cdk.aws_ecs.Secret });
        }

        const container = taskDefinition.addContainer('Container', {
            containerName,
            image: EcrImage.fromEcrRepository(props.ecrRepo),
            logging: LogDrivers.awsLogs({streamPrefix: logDriverTask, logRetention: 30}),
            environment: {
                PROFILE: props.profile,
                NEW_RELIC_APP_NAME: props.microservice.name.toLowerCase()+props.stage.toLowerCase(),
                ...props.fargateEnvironmentVariables,

            },
            readonlyRootFilesystem: props.rootReadOnly,
            secrets: {
                ...secrets,
            },
        });

        container.addMountPoints({
            sourceVolume: 'tmp',
            containerPath: '/mnt/tmp',
            readOnly: false,
        })
        props.portMappings.forEach((port => {
            container.addPortMappings({
                containerPort: port,
                hostPort: port
            });
        }))

        this.container = container;
        //----------Container

        //----------SecurityGroups
        const fargateSecurityGroup = new SecurityGroup(this, 'SecurityGroup', {
            securityGroupName: `${props.microservice.name}-${stage}-sg-default`,
            vpc: props.vpc
        });

        new StringParameter(this,'SecurityGroupParameter',{
            parameterName:`/${props.stage.toLowerCase()}/${props.microservice.name.toLocaleLowerCase()}/fargate-sg-id`,
            stringValue: fargateSecurityGroup.securityGroupId
        })

        this.fargateSecurityGroup = fargateSecurityGroup;

        //----------Fargate itself
        const cluster = new Cluster(this, 'Cluster', {
            clusterName: fargateClusterName,
            vpc: props.vpc,
            containerInsights: true,
        });

        // encrypt ephemeral storage
        const ephemeralEncryptionKey = new Key(this, 'EphemeralStorageKey', {
            alias: `${props.microservice.name}-${props.stage}-ephemeral-storage`,
            description: 'Kms key for microservices ephemeral storage',
            enableKeyRotation: true,
            pendingWindow: Duration.days(7),
        });

        const cfnCluster = cluster.node.defaultChild as CfnCluster;
        cfnCluster.configuration = {
            ...cfnCluster.configuration,
            managedStorageConfiguration: {
                ...cfnCluster.configuration,
                fargateEphemeralStorageKmsKeyId: ephemeralEncryptionKey.keyId,
            },
        };

        ephemeralEncryptionKey.addToResourcePolicy(new PolicyStatement({
            sid: 'Allow generate data key access for Fargate tasks.',
            principals: [new ServicePrincipal('fargate.amazonaws.com')],
            resources: ['*'],
            actions: ['kms:GenerateDataKeyWithoutPlaintext'],
            conditions: {
                'StringEquals': {
                    'kms:EncryptionContext:aws:ecs:clusterAccount': [
                        props.env.account,
                    ],
                    'kms:EncryptionContext:aws:ecs:clusterName': [
                        fargateClusterName
                    ],
                },
            },
        }));
        ephemeralEncryptionKey.addToResourcePolicy(new PolicyStatement({
            sid: 'Allow grant creation permission for Fargate tasks.',
            principals: [new ServicePrincipal('fargate.amazonaws.com')],
            resources: ['*'],
            actions: ['kms:CreateGrant'],
            conditions: {
                'StringEquals': {
                    'kms:EncryptionContext:aws:ecs:clusterAccount': [
                        props.env.account,
                    ],
                    'kms:EncryptionContext:aws:ecs:clusterName': [
                        fargateClusterName
                    ],
                },
                'ForAllValues:StringEquals': {
                    'kms:GrantOperations': ['Decrypt'],
                },
            },
        }));

        this.fargateService = new FargateService(this, 'FargateService', {
            serviceName: fargateServiceName,
            cluster: cluster,
            assignPublicIp: false,
            taskDefinition,
            securityGroups: [fargateSecurityGroup],
            desiredCount: props.taskDesiredCount,
            circuitBreaker: {rollback: true},
            enableExecuteCommand: props.enableExecuteCommand,
        })

        if (props.allowInternalConnections) {
            this.addServiceDiscovery(stage)
        }

        const proxySecretManager = sm.Secret.fromSecretCompleteArn(this, 'ProxySecret', props.proxyCredentials.secretsArn);
        const defaultNoProxy = 'amazonaws.com,vwapps.run,vwapps.io,vwgroup.io,vwgroup.com,vwg-connect.com,volkswagenag.com,cariad.cloud,cariad.digital,idp.cloud.vwgroup.com'
        const noProxy = props.noProxySuffixes ? defaultNoProxy+','+props.noProxySuffixes : defaultNoProxy;

        this.container.addEnvironment('PROXY_URL', 'proxy.resources.vwapps.cloud')
        this.container.addEnvironment('PROXY_PORT', '8080')
        this.container.addEnvironment('PROXY_PORT_HTTPS', '8080')
        this.container.addEnvironment('PROXY_PORT_HTTP', '8080')
        this.container.addEnvironment('NO_PROXY', noProxy)
        this.container.addSecret('PROXY_USER', cdk.aws_ecs.Secret.fromSecretsManager(proxySecretManager, 'username'))
        this.container.addSecret('PROXY_PASSWORD', cdk.aws_ecs.Secret.fromSecretsManager(proxySecretManager, 'password'))

        //----------Fargate itself
    }
    /**
     * Allows for connection between the fargate service and a given database
     * <br/>
     *
     * @param dbCredentials
     *      Should be created when creating an RDS instance and retrieved before passing
     * @param database
     *      Database cluster or instance passed down to function. Should always be of cluster type and never instance
     *
     * @example
     *      const fargate = new CustomFargate(...);
     *
     *      const dbCredentialsSecret = Secret.fromSecretNameV2(this,'DatabaseSecret' , props.credentials.secretName!);
     *
     *      fargate.addInternalAccess(dbCredentials, props.databaseCluster);
     */
    public allowConnectionToDatabase(dbCredentials: sm.ISecret, database: any) {

        if (isDatabaseCluster(database)) {
            this.fargateService.connections.allowTo(
                database,
                Port.tcp(database.clusterEndpoint.port),
                'Connection to database',
            );
        } else if (isDatabaseInstance(database)) {
            this.fargateService.connections.allowTo(
                database,
                Port.tcp(Number(database.dbInstanceEndpointPort)),
                'Connection to database',
            );
        }

        this.container.addSecret('DB_NAME', cdk.aws_ecs.Secret.fromSecretsManager(dbCredentials, 'dbname'))
        this.container.addSecret('DB_USER', cdk.aws_ecs.Secret.fromSecretsManager(dbCredentials, 'username'))
        this.container.addSecret('DB_PASSWORD', cdk.aws_ecs.Secret.fromSecretsManager(dbCredentials, 'password'))
        this.container.addSecret('DB_PORT', cdk.aws_ecs.Secret.fromSecretsManager(dbCredentials, 'port'))
        this.container.addSecret('DB_HOST', cdk.aws_ecs.Secret.fromSecretsManager(dbCredentials, 'host'))
    }

    private addServiceDiscovery(stage: string) {
        const namespaceArn = StringParameter.fromStringParameterName(this, 'PrivateDnsNamespaceArn', `/${stage}/academy/private-dns-namespace-arn`).stringValue;
        const namespaceId = StringParameter.fromStringParameterName(this, 'PrivateDnsNamespaceId', `/${stage}/academy/private-dns-namespace-id`).stringValue;
        const namespaceName = stage + 'internal';

        const privateDnsNameSpace = PrivateDnsNamespace.fromPrivateDnsNamespaceAttributes(this, 'PrivateDnsNamespace', {
            namespaceArn,
            namespaceId,
            namespaceName,
        });

        this.fargateService.enableCloudMap({
            name: this.microservice.name.toLowerCase(),
            cloudMapNamespace: privateDnsNameSpace,
            dnsRecordType: DnsRecordType.A,
        });
    }

    /**
     * Configures the internal connections to a specific service
     * <br/>
     *
     * @param parameterName
     *      Sting parameter name that contains the security group id
     * @param securityGroup
     *      Security group of the fargate service created
     * @param port
     *      Port where traffic should pass
     */
    public allowConnectionToInternalService(parameterName: string, securityGroup: SecurityGroup, port: number) {

        const serviceSgId = StringParameter.valueFromLookup(this, parameterName)

        const serviceSg = SecurityGroup.fromSecurityGroupId(this, `SecurityGroupLookup-${serviceSgId}`, serviceSgId)

        serviceSg.addIngressRule(Peer.securityGroupId(securityGroup.securityGroupId), Port.tcp(port))
    }

    /**
     * Configures the internal connections from a specific service
     * <br/>
     *
     * @param securityGroupName
     *      Security group name to allow connections from
     * @param fargateSecurityGroup
     *      Security group of the fargate service created
     * @param vpc
     *      The security group VPC
     * @param port
     *      Port where traffic should pass
     */
    public allowConnectionFromInternalService(securityGroupName: string, fargateSecurityGroup: SecurityGroup, port: number, vpc: IVpc) {

        const serviceSg = SecurityGroup.fromLookupByName(this, securityGroupName, securityGroupName, vpc)

        fargateSecurityGroup.addIngressRule(Peer.securityGroupId(serviceSg.securityGroupId), Port.tcp(port), `Allow connections from/to ${securityGroupName}`)
    }

    /**
     * Configures alarms for the target Fargate service for the following metrics:
     * <br/>
     *  - Memory usage
     *  - CPU usage
     *  - Running Tasks count
     * <br/>
     *
     * @param topicArn The topic ARN to send alarms to. This is mandatory.
     *
     * @param cpu An object containing configuration options for the CPU usage alarm:
     *   @param cpu.addMonitor Whether to add monitoring for the metric. Defaults to False.
     *   @param cpu.period The period (in minutes) over which the specified statistic is applied. Default: 1
     *   @param cpu.threshold The CPU usage threshold (as a percentage) that will trigger the alarm. Default: 85
     *   @param cpu.evaluationPeriods The number of periods over which data is compared to the specified threshold. Default: 2
     *   @param cpu.datapointsToAlarm The number of datapoints that must be breaching to trigger the alarm. Default: 1
     *   @param cpu.treatMissingData How to treat missing data points. Default: BREACHING
     *   @param cpu.comparisonOperator The arithmetic operation to use when comparing the specified statistic and threshold. Default: GREATER_THAN_OR_EQUAL_TO_THRESHOLD
     *
     * @param memory An object containing configuration options for the memory usage alarm:
     *   @param memory.addMonitor Whether to add monitoring for the metric. Defaults to False.
     *   @param memory.period The period (in minutes) over which the specified statistic is applied. Default: 1
     *   @param memory.threshold The memory usage threshold (in bytes) that will trigger the alarm. Default: 85
     *   @param memory.evaluationPeriods The number of periods over which data is compared to the specified threshold. Default: 2
     *   @param memory.datapointsToAlarm The number of datapoints that must be breaching to trigger the alarm. Default: 1
     *   @param memory.treatMissingData How to treat missing data points. Default: BREACHING
     *   @param memory.comparisonOperator The arithmetic operation to use when comparing the specified statistic and threshold. Default: GREATER_THAN_OR_EQUAL_TO_THRESHOLD
     *
     * @param runningTasks An object containing configuration options for the running tasks count alarm:
     *   @param runningTasks.addMonitor Whether to add monitoring for the metric. Defaults to False.
     *   @param runningTasks.period The period (in minutes) over which the specified statistic is applied. Default: 1
     *   @param runningTasks.threshold The value against which the specified statistic is compared. Default: 1
     *   @param runningTasks.evaluationPeriods The number of periods over which data is compared to the specified threshold. Default: 2
     *   @param runningTasks.datapointsToAlarm The number of datapoints that must be breaching to trigger the alarm. Default: 1
     *   @param runningTasks.treatMissingData How to treat missing data points. Default: BREACHING
     */


    public addMonitoring(topicArn: string, cpu: AlarmsInterface, memory: AlarmsInterface, runningTasks: AlarmsInterface) {

        let alarms = [];

        let memoryAlarm;
        let cpuAlarm;
        let runningTasksAlarm;

        if (memory.addMonitor) {
            memoryAlarm = new Alarm(this, 'MemoryAlarm', {
                alarmName: `${this.microservice.name}-${this.stage}-Memory-Alarm`,
                metric: this.fargateService.metricMemoryUtilization({
                    period: Duration.minutes(memory.period ?? 1),
                }),
                evaluationPeriods: memory.evaluationPeriods ?? 2,
                threshold: memory.threshold ?? 85,
                datapointsToAlarm: memory.datapointsToAlarm ?? 1,
                treatMissingData: memory.treatMissingData ?? TreatMissingData.BREACHING,
                comparisonOperator: memory.comparisonOperator ?? ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD
            })
            alarms.push(memoryAlarm)
        }

        if (cpu.addMonitor) {
            cpuAlarm = new Alarm(this, 'CpuAlarm', {
                alarmName: `${this.microservice.name}-${this.stage}-CPU-Alarm`,
                metric: this.fargateService.metricCpuUtilization({
                    period: Duration.minutes(cpu.period ?? 1),
                }),
                evaluationPeriods: cpu.evaluationPeriods ?? 2,
                threshold: cpu.threshold ?? 85,
                datapointsToAlarm: cpu.datapointsToAlarm ?? 1,
                treatMissingData: cpu.treatMissingData ?? TreatMissingData.BREACHING,
                comparisonOperator: cpu.comparisonOperator ?? ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            })

            alarms.push(cpuAlarm)
        }

        if (runningTasks.addMonitor) {
            runningTasksAlarm = new Alarm(this, 'RunningTasksAlarm', {
                alarmName: `${this.microservice.name}-${this.stage}-RunningTasks-Alarm`,
                metric: this.fargateService.metric('CPUUtilization', {
                    statistic: 'SampleCount',
                    period: Duration.minutes(runningTasks.period ?? 1),
                }),
                threshold: runningTasks.threshold ?? 1,
                datapointsToAlarm: runningTasks.datapointsToAlarm ?? 1,
                treatMissingData: runningTasks.treatMissingData ?? TreatMissingData.BREACHING,
                comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
                evaluationPeriods: runningTasks.evaluationPeriods ?? 2,
            });

            alarms.push(runningTasksAlarm)
        }

        const topic = Topic.fromTopicArn(this, 'TopicArn', topicArn)

        alarms.forEach((alarm) => {
            alarm.addAlarmAction(new SnsAction(topic));
        });

        return alarms
    }
}

function isDatabaseCluster(database: any): database is IDatabaseCluster {
    return (database as IDatabaseCluster).clusterEndpoint !== undefined;
}

function isDatabaseInstance(database: any): database is DatabaseInstance {
    return (database as DatabaseInstance).dbInstanceEndpointPort !== undefined;
}
