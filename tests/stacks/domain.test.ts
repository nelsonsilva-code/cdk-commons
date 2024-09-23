import {App} from "aws-cdk-lib";
import {CustomDomain} from "../../lib";
import {Template} from "aws-cdk-lib/assertions";

test('GIVEN all props WHEN initializing CustomDomain THEN a domain and a certificate are created', () => {
    const app = new App();
    const stack = new CustomDomain(app, 'TestStack',{
        domainPrefix: "Test",
        stage: "Academy",
        stackName: 'TestStack',
        env: { account: '123456789012', region: 'eu-west-1'},
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('VWS::Domain::Name', {
        "Domain": {
            "Name" : "Test.academy"
        }
    });

    template.hasResourceProperties('AWS::CertificateManager::Certificate', {
        "Tags": [
            {
                "Key": "Name",
                "Value": "TestStack/Certificate"
            }
        ]
    })

})