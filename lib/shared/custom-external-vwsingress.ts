import { Duration, SecretValue } from 'aws-cdk-lib';
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { IVpc, Peer, Port, SecurityGroup } from 'aws-cdk-lib/aws-ec2';
import {
  ApplicationListener,
  ApplicationListenerRule,
  ApplicationLoadBalancer,
  ApplicationProtocol,
  IApplicationTargetGroup,
  ListenerAction,
  ListenerCondition,
  SslPolicy,
  UnauthenticatedAction,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { CfnRecordSet } from 'aws-cdk-lib/aws-route53';
import { Bucket, BucketAccessControl, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import {CfnLoginClient} from "@vw-sre/vws-cdk";
import { IDomain } from "@vw-sre/vws-cdk";

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
  readonly domain: IDomain,
  /**
   * certificate for https
   */
  readonly certificates: ICertificate[],
  /**
   * Loadbalancer target group eg. a Lambda function
   */
  readonly targetGroup?: DefaultIngressTargetGroup
  /**
   * Loadbalancer target group eg. a Lambda function
   */
  readonly additionalTargetGroups?: IngressTargetGroup[]
  /**
   * retention time of logs in s3 bucket
   * duration should be days
   * @default 3 days
   */
  readonly logRetention?: Duration
  /**
   * for e.g. VWS1.0 routes
   */
  readonly additionalIdpCallbackUrls?: string[]

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

  /**
   * Set to true if you need external access in port 443 and 80 (forwards to 443)
   */
  readonly allowExternalHttpAndHttp?: boolean
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
export class CustomExternalVwsIngressV2 extends Construct {
  private static getAuthenticateOidc(loginClient: CfnLoginClient, targetGroup: DefaultIngressTargetGroup | IngressTargetGroup) {
    if (targetGroup.includeLogin) {
      const action = ListenerAction.authenticateOidc({
            authenticationRequestExtraParams: {
              display: 'page',
              prompt: 'login',
            },
            authorizationEndpoint: loginClient.authorizationEndpoint,
            clientId: SecretValue.secretsManager(loginClient.secretArn, {
              jsonField: 'client_id',
            }).unsafeUnwrap(),
            clientSecret: SecretValue.secretsManager(loginClient.secretArn, {
              jsonField: 'client_secret',
            }),
            issuer: loginClient.issuer,
            scope: 'openid profile email',
            sessionCookieName: 'x-session',
            sessionTimeout: Duration.seconds(28800),
            tokenEndpoint: loginClient.tokenEndpoint,
            userInfoEndpoint: loginClient.userInfoEndpoint,
            onUnauthenticatedRequest: UnauthenticatedAction.AUTHENTICATE,
            next: ListenerAction.forward([targetGroup.targetGroup]),
          },
      );
      return action;
    } else {
      return ListenerAction.forward([targetGroup.targetGroup]);
    }
  }

  public readonly loadBalancer: ApplicationLoadBalancer;
  /**
   * The SecurityGroup attached to the LoadBalancer
   */
  public readonly securityGroup: SecurityGroup;

  /**
   * The ApplicationListener which associates the TargetGroup with the LoadBalancer.
   * Only present after setting the default target group.
   */
  public applicationListener?: ApplicationListener;

  /**
   * The VWS:Login:Client used for authentication if enabled
   *
   * Consider it readonly!
   */
  public loginClient?: CfnLoginClient;
  private additionalIdpCallbackUrls?: string[];
  private readonly domainName: string;
  private readonly logoutUrls: string[] | undefined;

  private readonly certificates: ICertificate[];
  private defaultTargetGroupSet: boolean = false;

  public readonly accessLogBucketName?: string;

  constructor(scope: Construct, id: string, props: VwsIngressV2Properties) {
    super(scope, id);
    this.certificates = props.certificates;

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

    this.loadBalancer = new ApplicationLoadBalancer(this, 'LoadBalancer', {
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: this.securityGroup,
      idleTimeout: props.loadBalancerIdleTimeout || Duration.seconds(10),
      deletionProtection: props.deletionProtection,
    });

    this.loadBalancer.logAccessLogs(logBucket, 'access-logs');
    this.loadBalancer.setAttribute('routing.http.drop_invalid_header_fields.enabled', 'true');

    if (props.allowExternalHttpAndHttp) {
      this.securityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(80));
      this.securityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(443));
      this.loadBalancer.addRedirect({
        sourcePort: 80,
        sourceProtocol: ApplicationProtocol.HTTP,
        targetPort: 443,
        targetProtocol: ApplicationProtocol.HTTPS,
      });
    }

    this.additionalIdpCallbackUrls = props.additionalIdpCallbackUrls;
    this.domainName = props.domain.name;
    this.logoutUrls = props.logoutUrl;

    if (props.targetGroup) {
      this.defineDefaultTargetGroup(props.targetGroup!);
    }

    if (props.additionalTargetGroups) {
      for (let additionalTargetGroup of props.additionalTargetGroups) {
        this.addAdditionalTargetGroup(additionalTargetGroup);
      }
    }

    new CfnRecordSet(this, 'LoadBalancerAlias', {
      name: `${props.domain.name}.`,
      type: 'A',
      aliasTarget: {
        dnsName: `dualstack.${this.loadBalancer.loadBalancerDnsName}`,
        hostedZoneId: this.loadBalancer.loadBalancerCanonicalHostedZoneId,
      },
      hostedZoneId: props.domain.hostedZone.hostedZoneId,
      setIdentifier: props.recordSetWeight === undefined ? undefined : this.node.addr,
      weight: props.recordSetWeight === undefined ? undefined : props.recordSetWeight,
    });

    new CfnRecordSet(this, 'LoadBalancerAaaaAlias', {
      name: `${props.domain.name}.`,
      type: 'AAAA',
      aliasTarget: {
        dnsName: `dualstack.${this.loadBalancer.loadBalancerDnsName}`,
        hostedZoneId: this.loadBalancer.loadBalancerCanonicalHostedZoneId,
      },
      hostedZoneId: props.domain.hostedZone.hostedZoneId,
      setIdentifier: props.recordSetWeight === undefined ? undefined : this.node.addr,
      weight: props.recordSetWeight === undefined ? undefined : props.recordSetWeight,
    });

    this.node.addValidation({
      validate: () => {
        if (!this.defaultTargetGroupSet) {
          return ['No default target group set'];
        } else {
          return [];
        }
      },
    });
  }

  public defineDefaultTargetGroup(props: DefaultIngressTargetGroup) {
    if (this.defaultTargetGroupSet) {
      throw new Error('Default target group already set');
    }
    this.defaultTargetGroupSet = true;

    if (props.includeLogin && !this.loginClient) {
      this.loginClient = this.createLoginClient();
    }

    this.applicationListener = this.loadBalancer.addListener('HttpsListenerV2', {
      certificates: this.certificates,
      protocol: ApplicationProtocol.HTTPS,
      sslPolicy: SslPolicy.FORWARD_SECRECY_TLS12_RES_GCM,
      defaultAction: CustomExternalVwsIngressV2.getAuthenticateOidc(this.loginClient!, props),
    });
  }

  public addAdditionalTargetGroup(additionalTargetGroup: IngressTargetGroup) {
    if (!this.defaultTargetGroupSet) {
      throw new Error('Cannot add additional target group without default target group');
    }

    if (additionalTargetGroup.includeLogin && !this.loginClient) {
      this.loginClient = this.createLoginClient();
    }

    const listenerAction = CustomExternalVwsIngressV2.getAuthenticateOidc(this.loginClient!, additionalTargetGroup);
    new ApplicationListenerRule(this, 'Rule' + additionalTargetGroup.priority, {
      action: listenerAction,
      listener: this.applicationListener!,
      conditions: additionalTargetGroup.conditions,
      priority: additionalTargetGroup.priority,
    });
  }

  private createLoginClient() {
    const callbackUrls = this.additionalIdpCallbackUrls?.map(url => url + '/oauth2/idpresponse') ?? [];
    return new CfnLoginClient(this, 'PlatformLogin', {
      callbackUrl: [
        ...callbackUrls,
        `https://${this.domainName}/oauth2/idpresponse`,
      ],
      logoutUrl: this.logoutUrls,
    });
  }
}