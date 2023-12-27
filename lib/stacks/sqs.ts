import {Construct} from 'constructs';
import {Duration, Stack, StackProps} from "aws-cdk-lib";
import {IVpc} from "aws-cdk-lib/aws-ec2";
import { CfnProxyCredentials} from "@vw-sre/vws-cdk";
import {Microservice} from "../interfaces/microservice-interface";
import {Key, KeyUsage} from "aws-cdk-lib/aws-kms";
import {Queue} from "aws-cdk-lib/aws-sqs";

interface SqsProps {
    queueName: string,
    stackProps: StackProps,
    stage: "prod" | "prelive" | "develop",
    vpc: IVpc,
    maxReceiveCount: number
}

export class CustomSqs extends Stack {
    constructor(scope: Construct, microservice: Microservice, proxyCredentials: CfnProxyCredentials, props: SqsProps) {

        //----------VARIABLES
        const stage = props.stage;
        const queueName = props.queueName;
        const maxReceiveCount = props.maxReceiveCount
        //----------VARIABLES

        props.stackProps = {
            ...props.stackProps,
            stackName: `${stage.toUpperCase()}${microservice.name}SqsStack`
        }

        super(scope, props.stackProps.stackName, props.stackProps);

        const encryptionMasterKey = new Key(this, 'QueueEncryptionKey', {
            pendingWindow: Duration.days(10),
            keyUsage: KeyUsage.ENCRYPT_DECRYPT,
            enableKeyRotation: true,
            alias: `${queueName}-QueueEncryptionKey`,
            description: 'VW managed key used to encrypt the sqs notification queue.',
        });

        const deadLetterQueue = new Queue(this, 'DeadLetterQueue', {
            queueName: `${queueName}-DLQ`,
            encryptionMasterKey,
        });

        new Queue(this, 'Queue', {
            queueName: `${queueName}-Queue`,
            deadLetterQueue: {
                queue: deadLetterQueue,
                maxReceiveCount,
            },
            encryptionMasterKey,
        });
    }

}

