import { Construct } from 'constructs';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import { Domain } from '@vw-sre/vws-cdk';
import {EnvironmentStage} from "../interfaces";
import {Stack, StackProps} from "aws-cdk-lib";

interface CustomDomainStackProps extends StackProps {
  domainPrefix: string,
  stage: EnvironmentStage['stage'],
  stackName: string,
  env: {account: string, region: string}
}

export default class CustomDomain extends Stack {
  readonly domain: Domain;

  readonly certificate: Certificate;

  constructor(scope: Construct, id: string, props: CustomDomainStackProps) {
    super(scope, id, props);

    const stage = props.stage.toLowerCase();

    this.domain = new Domain(this, 'Domain', {
      domain: props.domainPrefix+'.'+stage,
    });

    this.certificate = new Certificate(this, 'Certificate', {
      domainName: this.domain.name,
      validation: CertificateValidation.fromDns(this.domain.hostedZone),
    });

  }
}