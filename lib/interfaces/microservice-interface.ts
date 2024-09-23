import {IVpc} from "aws-cdk-lib/aws-ec2";

export interface Microservice{
    name: string;
    gitRepo: string,
    gitOwner: string,
    secretManagerName?: string;
    vpc?: IVpc,
}