import {Construct} from "constructs";
import {Stack, StackProps} from "aws-cdk-lib";
import { IVpc, Vpc} from "aws-cdk-lib/aws-ec2";
import {CfnProxy, CfnProxyCredentials} from "@vw-sre/vws-cdk";
import {AccountPrincipal} from "aws-cdk-lib/aws-iam";
import {EnvironmentStage} from "../interfaces";

interface CustomVpcStackProps extends StackProps{
    stackProps: StackProps,
    stackName: string,
    stage: EnvironmentStage['stage'],
    env: {account: string, region: string},
    /**
     * List of ports allowed to connect to
     */
    allowedPorts?: number[],
    /**
     * List of allowed DNS suffixes.
     * Default allowed values:
     *  - 'amazonaws.com',
     *  - 'vwgroup.io',
     *  - 'cariad.digital',
     *  - 'vwapps.run',
     *  - 'log-api.eu.newrelic.com',
     *  - 'gradle.org',
     *  - 'nr-data.net',
     *  - 'nr-assets.net',
     *  - 'volkswagenag.com'
     */
    allowedSuffixes?: string[],
}

export default class CustomVpcStack extends Stack {
    public readonly vpc: IVpc;

    public readonly proxyCredentials: CfnProxyCredentials;

    public readonly proxy: CfnProxy;

    constructor(scope: Construct, id: string, props: CustomVpcStackProps) {

        super(scope, id, props);

        const defaultAllowedSuffixes = [
            'amazonaws.com',
            'vwgroup.io',
            'cariad.digital',
            'vwapps.run',
            'log-api.eu.newrelic.com',
            'gradle.org',
            'nr-data.net',
            'nr-assets.net',
            'volkswagenag.com'
        ];


        const allowedPorts = props.allowedPorts ? [...props.allowedPorts, 443, 80] : [443, 80];
        const allowedSuffixes = props.allowedSuffixes ? [...props.allowedSuffixes, ...defaultAllowedSuffixes] : defaultAllowedSuffixes
        this.proxy = new CfnProxy(this, 'EnvironmentProxy', {
            allowedCidrs: [],
            allowedPorts: allowedPorts,
            allowedSuffixes: allowedSuffixes
        });

        this.vpc = Vpc.fromLookup(this, "PdeVpc", {
            vpcName: `${props.stage}-Vpc`
        })

        this.proxyCredentials = new CfnProxyCredentials(this, 'ProxyCredentials', {
            instance: this.proxy,
            principals: [new AccountPrincipal(this.account).arn,],
        });

    }
}