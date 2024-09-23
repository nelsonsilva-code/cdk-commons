import {App, Duration, Stack} from "aws-cdk-lib";
import {CustomSqs, Microservice} from "../../lib";
import {Template} from "aws-cdk-lib/assertions";
import {IVpc} from "aws-cdk-lib/aws-ec2";

function createStack(
    queueDelay?: Duration,
    addMonitoring?: boolean,
    topicArn?: string,
    queueName?: string,
    fifo?: boolean
): Stack {
    const app = new App();
    const microservice = {
        name: "PdeTest",
    } as Microservice

    let vpc: IVpc;

    return new CustomSqs(app, 'TestStack',{
        microservice: microservice,
        stackProps: {},
        stackName: 'TestStack',
        stage: "Academy",
        vpc: vpc,
        maxReceiveCount: 1,
        queueDelay: queueDelay,
        env: { account: '123456789012', region: 'eu-west-1'},
        addMonitoring: addMonitoring,
        topicArn: topicArn,
        queueName: queueName,
        fifo: fifo,
    });
}

test('GIVEN mandatory props WHEN initializing CustomSqs THEN an encrypted SQS with DLQ is created', () => {

    const template = Template.fromStack(createStack())

    template.hasResource('AWS::KMS::Key', {});

    template.hasResourceProperties('AWS::KMS::Alias', {
        'AliasName' : 'alias/PdeTest-Academy-QueueEncryptionKey'
    });

    template.hasResourceProperties('AWS::SQS::Queue', {
        'QueueName':'PdeTest-Academy-DLQ'
    })

    template.hasResourceProperties('AWS::SQS::Queue', {
        'QueueName':'PdeTest-Academy-Queue',
    });

})

test('GIVEN monitoring props WHEN initializing CustomSqs THEN an encrypted SQS with DLQ is created and monitoring is enabled', () => {


    const template = Template.fromStack(createStack(
        undefined,
        true,
        'arn:aws:sns:eu-west-1:123456789012:test',
    ))

    template.hasResource('AWS::KMS::Key', {});

    template.hasResourceProperties('AWS::KMS::Alias', {
        'AliasName' : 'alias/PdeTest-Academy-QueueEncryptionKey'
    });

    template.hasResourceProperties('AWS::SQS::Queue', {
        'QueueName':'PdeTest-Academy-DLQ'
    })

    template.hasResourceProperties('AWS::SQS::Queue', {
        'QueueName':'PdeTest-Academy-Queue',
    });

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        'AlarmActions': ['arn:aws:sns:eu-west-1:123456789012:test'],
    })

    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    expect(Object.keys(alarms).length).toBe(2);

    Object.values(alarms).forEach(alarm => {
        expect(alarm.Properties.AlarmActions).toContain('arn:aws:sns:eu-west-1:123456789012:test');
    });
})

test('GIVEN delivery delay prop WHEN initializing CustomSqs THEN an encrypted SQS with DLQ is created with delivery delay', () => {


    const template = Template.fromStack(createStack(
        Duration.minutes(1),
    ))

    template.hasResource('AWS::KMS::Key', {});

    template.hasResourceProperties('AWS::KMS::Alias', {
        'AliasName' : 'alias/PdeTest-Academy-QueueEncryptionKey'
    });

    template.hasResourceProperties('AWS::SQS::Queue', {
        'QueueName':'PdeTest-Academy-DLQ'
    })

    template.hasResourceProperties('AWS::SQS::Queue', {
        'QueueName':'PdeTest-Academy-Queue',
        'DelaySeconds': 60
    });
})

test('GIVEN queue name prop WHEN initializing CustomSqs THEN an encrypted SQS with DLQ is created with custom name', () => {


    const template = Template.fromStack(createStack(
        undefined,
        undefined,
        undefined,
        'testname'
    ))

    template.hasResource('AWS::KMS::Key', {});

    template.hasResourceProperties('AWS::KMS::Alias', {
        'AliasName' : 'alias/testname-Academy-QueueEncryptionKey'
    });

    template.hasResourceProperties('AWS::SQS::Queue', {
        'QueueName':'testname-Academy-DLQ'
    })

    template.hasResourceProperties('AWS::SQS::Queue', {
        'QueueName':'testname-Academy-Queue',
    });
})

test('GIVEN fifo prop WHEN initializing CustomSqs THEN a FIFO SQS with DLQ is created', () => {

    const template = Template.fromStack(createStack(
        undefined,
        undefined,
        undefined,
        undefined,
        true,
    ))

    template.hasResource('AWS::KMS::Key', {});

    template.hasResourceProperties('AWS::KMS::Alias', {
        'AliasName' : 'alias/PdeTest-Academy-QueueEncryptionKey'
    });

    template.hasResourceProperties('AWS::SQS::Queue', {
        'QueueName':'PdeTest-Academy-DLQ.fifo'
    })

    template.hasResourceProperties('AWS::SQS::Queue', {
        'QueueName':'PdeTest-Academy-Queue.fifo',
    });

})

test('GIVEN queue name prop larger than 70 characters WHEN initializing CustomSqs THEN throw an error', () => {
    expect(() => {createStack(
        undefined,
        undefined,
        undefined,
        'a'.repeat(70)
    )}).toThrow('SQS name must be less than 70 characters.')
})

test('GIVEN no topic arn WHEN initializing CustomSqs with monitoring enabled THEN throw an error', () => {
    expect(() => {createStack(
        undefined,
        true,
        undefined,
    )}).toThrow('topicArn prop was not provided. This is mandatory when addMonitoring is set to true.')
})