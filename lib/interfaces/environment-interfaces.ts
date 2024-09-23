import {App, Duration} from "aws-cdk-lib";
import {Microservice} from "./microservice-interface";
import {InstanceClass, InstanceSize} from "aws-cdk-lib/aws-ec2";
import {ApplicationProfile, EnvironmentStage} from "./stage-interface";
import {AlarmsInterface} from "./alarms-interface";
import {DatabaseEngine} from "../types";

interface BaseInterface{
    app: App
    env: {
        account: string,
        region: string,
    }
    /**
     * Several microservice details/configs
     */
    microservice: Microservice
    ecrSuffix: string,
    githubSecretName: string,
    codestarProps: {
        owner: string,
        repo: string,
        connectionArn: string,
        branch: string,
        triggerOnPush: boolean,
    },
    /**
     * List of ports allowed to connect to
     */
    allowedProxyPorts?: number[],
    /**
     * List of allowed DNS suffixes
     */
    allowedProxySuffixes?: string[],
    /**
     * Simple string with entries that SHOULD NOT go through the proxy (e.g.: amazonaws.com,vwapps.run).
     */
    noProxySuffixes?: string,
}

type databaseProps = {
    databaseEngine: DatabaseEngine,
    /**
     * What class and generation of instance to use.
     * E.g.: T3, T4, R4.
     * @see {@link https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.DBInstanceClass.html} for more info
     */
    databaseInstanceClass: InstanceClass,
    /**
     * Prices (USD/month) and specs for instances are as follows (2024):
     * - Micro - 57.23 USD (1vCPUs - 1GB)
     * - Small - 83.51 USD (1vCPUs - 2GB)
     * - Medium - 137.53 USD (2vCPUs - 4GB)
     */
    databaseInstanceSize: InstanceSize,
    /**
     * Indicates whether the DB cluster should have deletion protection enabled. Defaults to true.
     */
    databaseDeletionProtection?: boolean
}

type fargateProps = {
    fargateClusterName: string,
    fargateServiceName: string,
    /**
     * @see {@link https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html#task_size}
     */
    fargateTaskDefinition: {
        cpu: number,
        memoryLimitMiB: number,
    },
    fargateHcPort: number,
    fargatePortMappings: number[],
    /**
     * Application profile to be used by application. This varies from environment to environment, but is pinned to 4 types.
     */
    appProfile: ApplicationProfile['profile'],
    taskDesiredCount: number,
    addFargateMonitoring?: {
        cpu?: AlarmsInterface,
        memory?: AlarmsInterface,
        runningTasks?: AlarmsInterface,
    },
}

type sqsProps = {
    maxReceiveCount: number,
    queueDelay?: Duration,
    addSqsMonitoring?: boolean,
    queueName?: string,
    fifo?: boolean
}

export interface ResourcesInterface extends BaseInterface {
    /**
     * Stage (AKA Environment) to be used by application. Pinned to 4 types.
     */
    stage: EnvironmentStage['stage']
    fargate: fargateProps
    database?: databaseProps
    sqs?: sqsProps
    alarmTopicArn?: string
}

