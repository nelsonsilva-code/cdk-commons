import {Construct} from 'constructs';
import {Duration, Stack, StackProps} from "aws-cdk-lib";
import {
    InstanceClass,
    InstanceSize,
    InstanceType,
    IVpc, SecurityGroup,
    SubnetType
} from "aws-cdk-lib/aws-ec2";
import {Microservice} from "../interfaces";
import {
    AuroraMysqlEngineVersion,
    ClusterInstance,
    Credentials,
    DatabaseCluster,
    DatabaseClusterEngine,
    DatabaseClusterFromSnapshot,
    DatabaseInstance,
    DatabaseInstanceEngine,
    IClusterEngine,
    IEngine,
    ParameterGroup, PostgresEngineVersion, SnapshotCredentials
} from "aws-cdk-lib/aws-rds";
import {IKey, Key, KeyUsage} from "aws-cdk-lib/aws-kms";
import {EnvironmentStage} from "../interfaces";
import {DatabaseEngine} from "../types";
import {StringParameter} from "aws-cdk-lib/aws-ssm";
import {ISecret} from "aws-cdk-lib/aws-secretsmanager";

interface CustomRdsProps extends StackProps{
    databaseName: string;
    stackProps: StackProps;
    stackName: string;
    microservice: Microservice;
    stage: EnvironmentStage['stage'];
    vpc: IVpc;
    /**
     * What class and generation of instance to use.
     * E.g.: T3, T4, R4.
     * @see {@link https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.DBInstanceClass.html} for more info
     */
    databaseInstanceClass: InstanceClass;
    /**
     * Prices (USD/month) and specs for instances are as follows:
     * - Micro - 57.23 USD (1vCPUs - 1GB)
     * - Small - 83.51 USD (1vCPUs - 2GB)
     * - Medium - 137.53 USD (2vCPUs - 4GB)
     */
    databaseInstanceSize: InstanceSize;
    databaseEngine: DatabaseEngine;
    env: {account: string, region: string},
    deletionProtection?: boolean;
    restoreFromSnapshot?: {
        snapshotIdentifier: string,
        databaseUsername: string,
    }
}

export default class CustomRds extends Stack {
    public readonly database;

    public readonly credentials!: ISecret;

    public readonly securityGroup: SecurityGroup;

    private readonly secretsEncryptionKey: IKey
    constructor(scope: Construct, id: string , props: CustomRdsProps) {
        super(scope, id, props);

        this.checkForErrors(props)

        this.secretsEncryptionKey = Key.fromLookup(this, 'SecretsEncryptionKey', {
            aliasName: 'alias/SecretsEncryptionKey',
        });

        const databaseEncryptionKey = new Key(this, 'RDSEncryptionKey', {
            pendingWindow: Duration.days(10),
            keyUsage: KeyUsage.ENCRYPT_DECRYPT,
            enableKeyRotation: true,
            alias: `${props.stage}-${props.microservice.name}-DatabaseEncryptionKey`,
            description: 'VW managed key used to encrypt and decrypt database instances',
        });

        this.securityGroup = new SecurityGroup(this, 'SecurityGroup', {
            securityGroupName: `${props.microservice.name}-${props.stage}-database-sg-default`,
            vpc: props.vpc
        });

        new StringParameter(this, 'DatabaseSecurityGroupParameter', {
            parameterName: `/${props.stage.toLowerCase()}/${props.microservice.name.toLowerCase()}/database-security-group`,
            stringValue: this.securityGroup.securityGroupId
        })

        if (props.databaseEngine === 'Postgres') {

            this.database = this.createPostgresDatabase(props, databaseEncryptionKey)

        } else {

            const engine = DatabaseClusterEngine.auroraMysql({
                version: AuroraMysqlEngineVersion.VER_3_06_0,
            });
            const clusterEngine = DatabaseClusterEngine.auroraMysql({
                version: AuroraMysqlEngineVersion.VER_3_06_0,
            });

            this.database = props.restoreFromSnapshot ? this.createDatabaseClusterFromSnapshot(props, databaseEncryptionKey, engine, clusterEngine) : this.createDatabaseCluster(props, databaseEncryptionKey, engine, clusterEngine)

            this.credentials = this.database.secret!
        }

    }

    private createDatabaseCluster(props: CustomRdsProps, databaseEncryptionKey: Key, engine: IEngine, clusterEngine: IClusterEngine) {

        const credentials = Credentials.fromUsername(`${props.stage}DatabaseMasterUser`, {
            secretName: `${props.stage}/${props.microservice.name.toLowerCase()}/database-credentials`,
            encryptionKey: this.secretsEncryptionKey,
        });

        const databaseParameterGroup = new ParameterGroup(this, 'ParameterGroup', {
            engine: engine,
            parameters: {
                character_set_client: 'utf8',
                character_set_connection: 'utf8',
                character_set_database: 'utf8',
                character_set_results: 'utf8',
                character_set_server: 'utf8',
                collation_connection: 'utf8_unicode_ci',
            },
        });

        const databaseCluster = new DatabaseCluster(this, 'Database', {
            engine: clusterEngine,
            defaultDatabaseName: `${props.databaseName}Database`,
            deletionProtection: props.deletionProtection ?? true,
            cloudwatchLogsExports: ['error', 'general', 'slowquery', 'audit'],
            iamAuthentication: true,
            backup: {
                retention: Duration.days(7),
            },
            vpc: props.vpc,
            vpcSubnets: {
                subnetType: SubnetType.PRIVATE_ISOLATED,
            },
            writer: ClusterInstance.provisioned('WriterInstance', {
                instanceType: InstanceType.of(props.databaseInstanceClass, props.databaseInstanceSize),
            }),
            readers: [
                ClusterInstance.provisioned('ReaderInstance', {
                    instanceType: InstanceType.of(props.databaseInstanceClass, props.databaseInstanceSize),
                }),
            ],
            storageEncrypted: true,
            storageEncryptionKey: databaseEncryptionKey,
            parameterGroup: databaseParameterGroup,
            credentials: credentials,
            securityGroups: [this.securityGroup]
        })

        new StringParameter(this, 'DatabaseClusterParameter', {
            parameterName: `/${props.stage.toLowerCase()}/${props.microservice.name.toLowerCase()}/mysql-database-cluster-identifier`,
            stringValue: databaseCluster.clusterIdentifier
        })

        return databaseCluster

    }

    private createPostgresDatabase(props: CustomRdsProps, databaseEncryptionKey: Key) {

        const credentials = Credentials.fromUsername(`${props.stage}DatabaseMasterUser`, {
            secretName: `${props.stage}/${props.microservice.name.toLowerCase()}/database-credentials`,
            encryptionKey: this.secretsEncryptionKey,
        });

        const databaseInstance = new DatabaseInstance(this, 'Database', {
            vpc: props.vpc,
            vpcSubnets: {
                subnetType: SubnetType.PRIVATE_ISOLATED,
            },
            instanceType: InstanceType.of(props.databaseInstanceClass, props.databaseInstanceSize),
            engine: DatabaseInstanceEngine.postgres({ version: PostgresEngineVersion.VER_16_3 }),
            credentials: credentials,
            backupRetention: Duration.days(7),
            deleteAutomatedBackups: false,
            deletionProtection: props.deletionProtection ?? true,
            cloudwatchLogsExports: ['postgresql'],
            storageEncrypted: true,
            storageEncryptionKey: databaseEncryptionKey,
            iamAuthentication: true,
            securityGroups: [this.securityGroup],
        });

        new StringParameter(this, 'DatabaseInstanceParameter', {
            parameterName: `/${props.stage.toLowerCase()}/${props.microservice.name.toLowerCase()}/postgres-database-instance-identifier`,
            stringValue: databaseInstance.instanceIdentifier
        })

        return databaseInstance
    }
    private createDatabaseClusterFromSnapshot(props: CustomRdsProps, databaseEncryptionKey: Key, engine: IEngine, clusterEngine: IClusterEngine) {
        const databaseParameterGroup = new ParameterGroup(this, 'ParameterGroup', {
            engine: engine,
            parameters: {
                character_set_client: 'utf8',
                character_set_connection: 'utf8',
                character_set_database: 'utf8',
                character_set_results: 'utf8',
                character_set_server: 'utf8',
                collation_connection: 'utf8_unicode_ci',
            },
        });

        const databaseCluster = new DatabaseClusterFromSnapshot(this, 'Database', {
            engine: clusterEngine,
            defaultDatabaseName: `${props.databaseName}Database`,
            deletionProtection: props.deletionProtection ?? true,
            cloudwatchLogsExports: ['error', 'general', 'slowquery', 'audit'],
            iamAuthentication: true,
            backup: {
                retention: Duration.days(7),
            },
            vpc: props.vpc,
            vpcSubnets: {
                subnetType: SubnetType.PRIVATE_ISOLATED,
            },
            writer: ClusterInstance.provisioned('WriterInstance', {
                instanceType: InstanceType.of(props.databaseInstanceClass, props.databaseInstanceSize),
            }),
            readers: [
                ClusterInstance.provisioned('ReaderInstance', {
                    instanceType: InstanceType.of(props.databaseInstanceClass, props.databaseInstanceSize),
                }),
            ],
            storageEncrypted: true,
            storageEncryptionKey: databaseEncryptionKey,
            parameterGroup: databaseParameterGroup,
            snapshotIdentifier: props.restoreFromSnapshot!.snapshotIdentifier,
            securityGroups: [this.securityGroup],
            snapshotCredentials: SnapshotCredentials.fromGeneratedSecret(props.restoreFromSnapshot!.databaseUsername, {
                encryptionKey: this.secretsEncryptionKey
            })
        })

        new StringParameter(this, 'DatabaseClusterParameter', {
            parameterName: `/${props.stage.toLowerCase()}/${props.microservice.name.toLowerCase()}/mysql-database-cluster-identifier`,
            stringValue: databaseCluster.clusterIdentifier
        })

        return databaseCluster
    }

    private checkForErrors(props: CustomRdsProps) {

        if (props.restoreFromSnapshot && props.databaseEngine === 'Postgres') {
            throw new Error('Restore from snapshot is currently not supported for Postgres instances')
        }

    }
}