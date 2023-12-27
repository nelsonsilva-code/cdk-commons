import { Construct } from 'constructs';
import { Stack, StackProps } from 'aws-cdk-lib';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import { Domain } from '@vw-sre/vws-cdk';

interface DomainStackProps extends StackProps {
  domainPrefix: string;
}

export class CustomDomain extends Stack {
  readonly domain: Domain;

  readonly certificate: Certificate;

  constructor(scope: Construct, id: string, props: DomainStackProps) {
    super(scope, id, props);

    this.domain = new Domain(this, 'Domain', {
      domain: props.domainPrefix+'.develop',
    });

    this.certificate = new Certificate(this, 'Certificate', {
      domainName: this.domain.name,
      validation: CertificateValidation.fromDns(this.domain.hostedZone),
    });

  }
}