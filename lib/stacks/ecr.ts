import {Construct} from "constructs";
import {IRepository, Repository} from "aws-cdk-lib/aws-ecr";
import {RemovalPolicy, Stack, StackProps} from "aws-cdk-lib";
import {Microservice} from "../interfaces";

interface CustomEcrProps extends StackProps {
    microservice: Microservice,
    suffix: string,
    stackName: string,
    env: {account: string, region: string}
}

export default class CustomEcr extends Stack {
    public readonly ecrRepo: IRepository;

    constructor(app: Construct, id: string,  props: CustomEcrProps) {
        super(app, id, props);

        this.ecrRepo = new Repository(this, 'ECR-Repository', {
            repositoryName: `${props.microservice.name.toLowerCase()}${props.suffix}`,
            imageScanOnPush: false,
            removalPolicy: RemovalPolicy.DESTROY,
            emptyOnDelete: true,
            lifecycleRules: [{
                maxImageCount: 25,
            }]
        });
    }
}