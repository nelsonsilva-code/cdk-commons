import {Construct} from 'constructs';
import {Duration, Stack, StackProps} from "aws-cdk-lib";
import {IVpc} from "aws-cdk-lib/aws-ec2";
import {Key, KeyUsage} from "aws-cdk-lib/aws-kms";
import {Queue} from "aws-cdk-lib/aws-sqs";
import {Microservice} from "../interfaces";
import {EnvironmentStage} from "../interfaces";
import {Alarm, ComparisonOperator, TreatMissingData} from "aws-cdk-lib/aws-cloudwatch";
import {SnsAction} from "aws-cdk-lib/aws-cloudwatch-actions";
import {Topic} from "aws-cdk-lib/aws-sns";

interface SqsProps extends StackProps{
    microservice: Microservice,
    stackProps: StackProps,
    stackName: string,
    stage: EnvironmentStage['stage'];
    vpc: IVpc,
    maxReceiveCount: number,
    env: {account: string, region: string},
    queueDelay?: Duration
    addMonitoring?: boolean,
    topicArn?: string,
    queueName?: string,
    fifo?: boolean
}

export default class CustomSqs extends Stack {
    public readonly queue: Queue

    public readonly dlQueue: Queue

    public readonly encryptionMasterKey: Key

    private readonly queueName: string
    constructor(scope: Construct, id: string, props: SqsProps) {
        super(scope, id, props);

        //----------VARIABLES
        this.queueName = props.queueName ? props.queueName+'-'+props.stage : props.microservice.name+'-'+props.stage;
        //----------VARIABLES

        this.checkForErrors(props)

        this.encryptionMasterKey = new Key(this, 'QueueEncryptionKey', {
            pendingWindow: Duration.days(10),
            keyUsage: KeyUsage.ENCRYPT_DECRYPT,
            enableKeyRotation: true,
            alias: `${this.queueName}-QueueEncryptionKey`,
            description: `VW managed key used to encrypt the ${this.queueName} sqs notification queue.`,
        });

        this.dlQueue = new Queue(this, 'DeadLetterQueue', {
            queueName: props.fifo ? `${this.queueName}-DLQ.fifo` : `${this.queueName}-DLQ`,
            encryptionMasterKey: this.encryptionMasterKey,
        });

        this.queue = new Queue(this, 'Queue', {
            queueName: props.fifo ? `${this.queueName}-Queue.fifo` : `${this.queueName}-Queue`,
            fifo: props.fifo,
            deadLetterQueue: {
                queue: this.dlQueue,
                maxReceiveCount: props.maxReceiveCount,
            },
            encryptionMasterKey: this.encryptionMasterKey,
            deliveryDelay: props.queueDelay !== undefined ? props.queueDelay : undefined,
        });

        if (props.addMonitoring) {
            this.addMonitoring(props.topicArn!)
        }

    }

    private addMonitoring(topicArn: string) {

        let alarms = []

        const ageAlarm = new Alarm(this, `AgeOfOldestMessage-Alarm`, {
            alarmName: `${this.queue.queueName}-AgeOfOldestMessage-Alarm`,
            metric: this.queue.metricApproximateAgeOfOldestMessage(),
            threshold: 1,
            datapointsToAlarm: 1,
            treatMissingData:TreatMissingData.NOT_BREACHING,
            comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
            evaluationPeriods: 2,
        });

        alarms.push(ageAlarm)

        const numberAlarm = new Alarm(this, `NumberOfMessagesVisible-Alarm`, {
            alarmName: `${this.queue.queueName}-NumberOfMessagesVisible-Alarm`,
            metric: this.queue.metricApproximateNumberOfMessagesVisible(),
            threshold: 1,
            datapointsToAlarm: 1,
            treatMissingData:TreatMissingData.NOT_BREACHING,
            comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
            evaluationPeriods: 2,
        });

        alarms.push(numberAlarm)

        const topic = Topic.fromTopicArn(this, 'TopicArn', topicArn)

        alarms.forEach((alarm) => {
            alarm.addAlarmAction(new SnsAction(topic));
        });

    }

    private checkForErrors(props: SqsProps) {

        if (this.queueName.length >= 70) {
            throw new Error('SQS name must be less than 70 characters.')
        }

        if (props.addMonitoring && !props.topicArn) {
            throw new Error('topicArn prop was not provided. This is mandatory when addMonitoring is set to true.')
        }
    }
}
