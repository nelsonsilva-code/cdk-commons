import {Construct} from "constructs";
import {Stack, StackProps} from "aws-cdk-lib";
import { IVpc, Vpc} from "aws-cdk-lib/aws-ec2";
import {CfnProxy, CfnProxyCredentials} from "@vw-sre/vws-cdk";
import {AccountPrincipal} from "aws-cdk-lib/aws-iam";

export class CustomVpc extends Stack {
    public readonly vpc: IVpc;
    public readonly proxyCredentials: CfnProxyCredentials;

    constructor(scope: Construct, id: string, vpcId: string, props?: StackProps) {
        props = {
            ...props,
            stackName: id
        }

        super(scope, id, props);

        const proxy = new CfnProxy(this, 'EnvironmentProxy', {
            allowedCidrs: [],
            allowedPorts: [443],
            allowedSuffixes: ['vwgroup.io','cariad.digital', 'vwapps.run', 'log-api.eu.newrelic.com','gradle.org','nr-data.net','nr-assets.net'],
        });

        this.vpc = Vpc.fromLookup(this, "PdeVpc", { vpcId })
  /*
        IF THE VPC USED DOESNT HAVE THIS ENDPOINT; REMOVE TE COMMENT


        this.vpc.addInterfaceEndpoint('ProxyEndpoint', {
            service: new InterfaceVpcEndpointService(proxy.serviceName, 8080),
            subnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
            privateDnsEnabled: true,
        });*/
        this.proxyCredentials = new CfnProxyCredentials(this, 'ProxyCredentials', {
            instance: proxy,
            principals: [new AccountPrincipal(this.account).arn,],
        });

    }
}