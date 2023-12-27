import {Construct} from "constructs";
import {IRepository, Repository} from "aws-cdk-lib/aws-ecr";
import {RemovalPolicy, Stack, StackProps} from "aws-cdk-lib";
import {Microservice} from "../interfaces/microservice-interface";

export class CustomEcr extends Stack {
    public readonly repo: IRepository;

    constructor(app: Construct, microservice: Microservice, suffix: string,  props?: StackProps) {
        props = {
            ...props,
            stackName: `${microservice.name}${suffix}EcrStack`
        }
        super(app, props.stackName, props);
        this.repo = new Repository(this, microservice.name.toLowerCase()+suffix, {
            repositoryName: `${microservice.name.toLowerCase()}_${suffix}`,
            imageScanOnPush: false,
            removalPolicy: RemovalPolicy.DESTROY,
        });

    }

}