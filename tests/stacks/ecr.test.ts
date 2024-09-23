import {App} from "aws-cdk-lib";
import {CustomEcr, Microservice} from "../../lib";
import {Template} from "aws-cdk-lib/assertions";

test('GIVEN all props WHEN initializing CustomEcr THEN an ECR repository is created', () => {
    const app = new App();
    const microservice = {
        name: "PdeTest",
    } as Microservice

    const stack = new CustomEcr(app, 'TestStack',{
        microservice: microservice,
        suffix: "_test",
        stackName: 'TestStack',
        env: { account: '123456789012', region: 'eu-west-1'},
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::ECR::Repository", {
        "RepositoryName": "pdetest_test"
    })
})