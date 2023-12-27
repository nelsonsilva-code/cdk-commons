import {IRepository} from "aws-cdk-lib/aws-ecr";
import {IVpc} from "aws-cdk-lib/aws-ec2";
import {HostedZoneAttributes} from "aws-cdk-lib/aws-route53/lib/hosted-zone-ref";
import {SecretValue} from "aws-cdk-lib";

export interface Microservice{
    secretManagerName: string;
    name: string;
    gitRepo: string,
    devDnsZone: HostedZoneAttributes,
    preLiveDnsZone: HostedZoneAttributes,
    prodDnsZone: HostedZoneAttributes,
    ecrSnapshotRepo: IRepository,
    ecrReleaseRepo: IRepository
    vpcDevelop: IVpc,
    vpcPrelive: IVpc,
    vpcProd: IVpc,
    repoOauthToken: SecretValue
}

