import { IAspect } from 'aws-cdk-lib';
import { IConstruct } from 'constructs';
import { CfnBucket } from 'aws-cdk-lib/aws-s3';

export class EnableObjectOwnership implements IAspect {

  visit(node: IConstruct) {
    if (node instanceof CfnBucket) {
      node.ownershipControls = {
        rules: [{
          objectOwnership: 'ObjectWriter',
        }],
      };
    }
  }
}
