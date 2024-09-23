import {App, Stack} from "aws-cdk-lib";
import {CustomRds, CustomVpcStack, Microservice} from "../../lib";
import {InstanceClass, InstanceSize} from "aws-cdk-lib/aws-ec2";
import {Template} from "aws-cdk-lib/assertions";

function createStack(
    databaseEngine: "AuroraMySql" | "Postgres",
    deletionProtection?: boolean,
    restoreFromSnapshot?: {
        snapshotIdentifier: string,
        databaseUsername: string,
    }
): Stack {
    const app = new App();

    const microservice = {
        name: "PdeTest",
    } as Microservice


    const {vpc} = new CustomVpcStack(app, 'TestVpcStack',{
        stackProps: {},
        stackName: 'TestVpcStack',
        stage: 'Academy',
        env: { account: '123456789012', region: 'eu-west-1'},
        allowedPorts: [80, 443],
        allowedSuffixes: ['test.com']
    });

    return new CustomRds(app, 'TestStack',{
        microservice: microservice,
        stackProps: {},
        stackName: 'TestStack',
        stage: "Academy",
        vpc: vpc,
        env: { account: '123456789012', region: 'eu-west-1'},
        deletionProtection: deletionProtection,
        databaseEngine: databaseEngine,
        databaseInstanceClass: InstanceClass.T4G,
        databaseInstanceSize: InstanceSize.MEDIUM,
        databaseName: "Test",
        restoreFromSnapshot: restoreFromSnapshot
    });
}

test("GIVEN mandatory props WHEN initializing CustomRds with aurora engine THEN create DB Cluster and Instances", () => {

    const template = Template.fromStack(createStack(
        "AuroraMySql",
    ))

    template.hasResourceProperties('AWS::RDS::DBCluster', {
        "DatabaseName": "TestDatabase",
        "Engine": "aurora-mysql",
        "EnableCloudwatchLogsExports": [
            "error",
            "general",
            "slowquery",
            "audit"
        ],
    });

    const instances = template.findResources('AWS::RDS::DBInstance');
    expect(Object.keys(instances).length).toBe(2);
})

test("GIVEN restoreFromSnapshot props WHEN initializing CustomRds with aurora engine THEN create DB Cluster and Instances", () => {

    const template = Template.fromStack(createStack(
        "AuroraMySql",
        undefined,
        {
            snapshotIdentifier: "test",
            databaseUsername: "Test",
        }
    ))

    template.hasResourceProperties('AWS::RDS::DBCluster', {
        "DatabaseName": "TestDatabase",
        "Engine": "aurora-mysql",
        "EnableCloudwatchLogsExports": [
            "error",
            "general",
            "slowquery",
            "audit"
        ],
        "SnapshotIdentifier": "test"
    });

    template.hasResourceProperties('AWS::SecretsManager::Secret', {
        "GenerateSecretString": {
            'SecretStringTemplate': '{\"username\":\"Test\"}'
        }
    })

    const instances = template.findResources('AWS::RDS::DBInstance');
    expect(Object.keys(instances).length).toBe(2);
})

test("GIVEN mandatory props WHEN initializing CustomRds with postgres engine THEN create DB Cluster and Instances", () => {

    const template = Template.fromStack(createStack(
        "Postgres",
    ))

    template.hasResourceProperties('AWS::RDS::DBInstance', {
        "Engine": "postgres",
        "EnableCloudwatchLogsExports": [
            "postgresql"
        ],
    });
})

test("GIVEN restoreFromSnapshot props WHEN initializing CustomRds with postgres engine THEN throw error", () => {

    expect(() => {createStack(
        "Postgres",
        undefined,
        {
            snapshotIdentifier: "test",
            databaseUsername: "Test",
        }
    )}).toThrow('Restore from snapshot is currently not supported for Postgres instances')
})

test("GIVEN empty deletionProtection prop WHEN initializing CustomRds with postgres engine THEN set deletion protection to true", () => {

    const template = Template.fromStack(createStack(
        "AuroraMySql",
    ))

    template.hasResourceProperties('AWS::RDS::DBCluster', {
        "DeletionProtection": true,
    });
})