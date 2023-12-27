import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {Aspects, Duration, Stack, StackProps} from "aws-cdk-lib";
import {
    Cluster,
    CpuArchitecture, EcrImage, FargateService,
    FargateTaskDefinition, IBaseService,
    LogDrivers,
    OperatingSystemFamily
} from "aws-cdk-lib/aws-ecs";

import {
    InstanceClass,
    InstanceSize,
    InstanceType,
    IVpc,
    Peer,
    Port,
    SecurityGroup,
    SubnetType
} from "aws-cdk-lib/aws-ec2";

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
import {
    AuroraMysqlEngineVersion,
    Credentials, DatabaseCluster,
    DatabaseClusterEngine,
    IDatabaseInstance,
    ParameterGroup
} from "aws-cdk-lib/aws-rds";
import {Key, KeyUsage} from "aws-cdk-lib/aws-kms";
import {Secret} from "aws-cdk-lib/aws-secretsmanager";



interface RdsProps {
    taskDesiredCount: number;
    databaseName: string,
    stackProps: StackProps,
    stage: "prod" | "prelive" | "develop",
    vpc: IVpc,
    ecrRepo:IRepository,
    profile: string
    databaseInstanceSize: InstanceSize
}

export class CustomRds extends Stack {
    constructor(scope: Construct, microservice: Microservice, proxyCredentials: CfnProxyCredentials, props: RdsProps) {

        //----------VARIABLES
        const stage = props.stage;
        const databaseName = props.databaseName;
        const vpc = props.vpc;
        const databaseInstanceSize = props.databaseInstanceSize;
        //----------VARIABLES

        props.stackProps = {
            ...props.stackProps,
            stackName: `${stage.toUpperCase()}${microservice.name}RdsStack`
        }

        super(scope, props.stackProps.stackName, props.stackProps);


        const secretsEncryptionKey = Key.fromLookup(this, 'EncryptionKey', {
            aliasName: 'alias/SecretsEncryptionKey',
        });

        const databaseParameterGroup = new ParameterGroup(this, 'ParameterGroup', {
            engine: DatabaseClusterEngine.auroraMysql({ version: AuroraMysqlEngineVersion.VER_2_11_2 }),
            parameters: {
                character_set_client: 'utf8',
                character_set_connection: 'utf8',
                character_set_database: 'utf8',
                character_set_results: 'utf8',
                character_set_server: 'utf8',
                collation_connection: 'utf8_unicode_ci',
            },
        });

        const databaseEncryptionKey = new Key(this, 'EncryptionKey', {
            pendingWindow: Duration.days(10),
            keyUsage: KeyUsage.ENCRYPT_DECRYPT,
            enableKeyRotation: true,
            alias: `${stage}-PdeMail-DatabaseEncryptionKey`,
            description: 'VW managed key used to encrypt and decrypt pde mail database instance',
        });

        const credentials = Credentials.fromUsername(`${stage}MailDatabaseMasterUser`, {
            secretName: `${stage}/pde-mail/database-credentials`,
            encryptionKey: secretsEncryptionKey,
        });

        const databaseClusterProps = {
            engine: DatabaseClusterEngine.auroraMysql({ version: AuroraMysqlEngineVersion.VER_2_11_2 }),
            defaultDatabaseName: databaseName,
            deletionProtection: true,
            cloudwatchLogsExports: ['error', 'general', 'slowquery', 'audit'],
            iamAuthentication: true,
            instances: 2,
            backup: {
                retention: Duration.days(7),
            },
            instanceProps: {
                vpc,
                instanceType: InstanceType.of(InstanceClass.T2, databaseInstanceSize),
                vpcSubnets: {
                    subnetType: SubnetType.PRIVATE_ISOLATED,
                },
            },
            storageEncrypted: true,
            storageEncryptionKey: databaseEncryptionKey,
            parameterGroup: databaseParameterGroup,
            credentials,
        };

        new DatabaseCluster(this, 'Database', databaseClusterProps)

    }
}