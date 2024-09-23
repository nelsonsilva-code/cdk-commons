import {App} from "aws-cdk-lib";
import {CustomVpcStack} from "../../lib";
import {Template} from "aws-cdk-lib/assertions";


test('GIVEN all props WHEN initializing CustomVpcStack THEN a VPC and VWS Proxy instance are created', () => {
    const app = new App();
    const stack = new CustomVpcStack(app, 'TestStack',{
        stackProps: {},
        stackName: 'TestStack',
        stage: 'Academy',
        env: { account: '123456789012', region: 'eu-west-1'},
        allowedPorts: [1111],
        allowedSuffixes: ['test.com']
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('VWS::Proxy::Instance', {
        AllowedSuffixes: [
            'test.com',
            'amazonaws.com',
            'vwgroup.io',
            'cariad.digital',
            'vwapps.run',
            'log-api.eu.newrelic.com',
            'gradle.org',
            'nr-data.net',
            'nr-assets.net',
            'volkswagenag.com'
        ],
        AllowedPorts: [
            "1111",
            "443",
            "80"
        ]
    })

    template.hasResource('VWS::Proxy::Credentials', {})
});