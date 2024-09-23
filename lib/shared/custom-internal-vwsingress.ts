import { Duration } from 'aws-cdk-lib';
import { IVpc, SecurityGroup } from 'aws-cdk-lib/aws-ec2';
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  IApplicationTargetGroup,
  ListenerAction,
  ListenerCondition,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { CfnRecordSet, PrivateHostedZone } from 'aws-cdk-lib/aws-route53';
import { Bucket, BucketAccessControl, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { CfnLoginClient } from "@vw-sre/vws-cdk";


export interface DefaultIngressTargetGroup {
  readonly targetGroup: IApplicationTargetGroup
  readonly includeLogin: boolean
}

export interface IngressTargetGroup {
  readonly targetGroup: IApplicationTargetGroup
  readonly includeLogin: boolean
  readonly conditions?: ListenerCondition[]
  /**
   * Priority of this target group.
   * The rule with the lowest priority will be used for every request. If priority is not given, these target groups will be added as defaults, and must not have conditions.
   * Priorities must be unique.
   */
  readonly priority: number
}

/**
 * Properties for VwsIngress construct
 */
export interface VwsIngressV2Properties {
  /**
   * vpc for the LoadBalancer
   */
  readonly vpc: IVpc,
  /**
   * a vws domain
   */
  readonly microserviceName: string,
  /**
   * certificate for https
   */
  /**
   * Loadbalancer target group eg. a Lambda function
   */
  readonly targetGroup: DefaultIngressTargetGroup
  /**
   * Loadbalancer target group eg. a Lambda function
   */
  /**
   * retention time of logs in s3 bucket
   * duration should be days
   * @default 3 days
   */
  readonly logRetention?: Duration
  /**
   * for e.g. VWS1.0 routes
   */

  /**
   * Idle timeout used in the ApplicationLoadBalancer.
   * Defaults to 10 seconds in this module.
   */
  readonly loadBalancerIdleTimeout?: Duration
  /**
   * list of allowed logout redirect urls when using authentication
   */
  readonly logoutUrl?: string[]

  /**
   * Supply this if you want to use a weighted RecordSet
   * Otherwise a simple RecordSet will be used
   */
  readonly recordSetWeight?: number;

  /**
   * deletion protection for the Application Load Balancer
   */
  readonly deletionProtection?: boolean
}

/**
 * VwsIngress construct
 *
 * Creates:
 * - log s3 Bucket for LoadBalancer logs
 * - security group for the LoadBalancer
 * - LoadBalancer
 * - LoadBalancer Listener with or without KUMS login protection
 * - Loadbalancer alias in a given domain
 */
export class CustomInternalVwsIngressV2 extends Construct {

  public readonly loadBalancer: ApplicationLoadBalancer;
  /**
   * The SecurityGroup attached to the LoadBalancer
   */
  public readonly securityGroup: SecurityGroup;

  public readonly privateHostedZone: PrivateHostedZone;

  public loginClient?: CfnLoginClient;

 
  public readonly accessLogBucketName?: string;

  constructor(scope: Construct, id: string, props: VwsIngressV2Properties) {
    super(scope, id);

    
    const logBucket = new Bucket(this, 'LogBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      lifecycleRules: [
        {
          id: '1',
          expiration: props.logRetention ? props.logRetention : Duration.days(3),
          enabled: true,
        },
        {
          id: '2',
          abortIncompleteMultipartUploadAfter: Duration.days(3),
          enabled: true,
        },
      ],
      accessControl: BucketAccessControl.LOG_DELIVERY_WRITE,
      enforceSSL: true,
    });
    this.accessLogBucketName = logBucket.bucketName;

    this.securityGroup = new SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
      allowAllOutbound: true,
    });

    this.privateHostedZone = new PrivateHostedZone(this,'PrivateHostedZone',{
      zoneName: `${props.microserviceName}.internal`,
      vpc: props.vpc
    })

    this.loadBalancer = new ApplicationLoadBalancer(this,'ApplicationLoadBalancer', {
      vpc: props.vpc,
      securityGroup: this.securityGroup,
      internetFacing: false,
      idleTimeout: Duration.seconds(30)
    })
    this.loadBalancer.logAccessLogs(logBucket, 'access-logs');
    this.loadBalancer.setAttribute('routing.http.drop_invalid_header_fields.enabled', 'true');
    this.loadBalancer.addListener('listener',{
      protocol: ApplicationProtocol.HTTP,
      defaultAction: ListenerAction.forward([props.targetGroup.targetGroup]),
      open: false
    })

    new CfnRecordSet(this, 'LoadBalancerAlias', {
      name: this.privateHostedZone.zoneName,
      type: 'A',
      aliasTarget: {
        dnsName: this.loadBalancer.loadBalancerDnsName,
        hostedZoneId: this.loadBalancer.loadBalancerCanonicalHostedZoneId,
      },
      hostedZoneId: this.privateHostedZone.hostedZoneId,
    });



}}