import {Duration, RemovalPolicy, StackProps, Tags} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {Artifact, ArtifactPath, Pipeline, StagePlacement} from "aws-cdk-lib/aws-codepipeline";
import {
  CodeBuildAction,
  CodeStarConnectionsSourceAction,
  EcsDeployAction, ManualApprovalAction,
} from "aws-cdk-lib/aws-codepipeline-actions";
import {IProject} from "aws-cdk-lib/aws-codebuild";
import {CfnProxy} from "@vw-sre/vws-cdk";
import {Microservice} from "../interfaces";
import {BuildProject, SynthProject} from "../interfaces/pipeline-projects-interface";
import {IBaseService} from "aws-cdk-lib/aws-ecs";
import {Bucket} from "aws-cdk-lib/aws-s3";
import {Key, KeyUsage} from "aws-cdk-lib/aws-kms";
import {EnvironmentStage} from "../interfaces";
import {IVpc} from "aws-cdk-lib/aws-ec2";

interface CodepipelineProps {
  stackProps: StackProps,
  stage: EnvironmentStage['stage'],
  microservice: Microservice,
  env: {account: string, region: string},
  sourceAction: CodeStarConnectionsSourceAction,
  vpc: IVpc,
  proxy: CfnProxy,
  sourceArtifact: Artifact,
  synthProject: SynthProject,
  buildProject: BuildProject,
}

export default class CustomCodepipeline extends Construct {
  public synthArtifact: Artifact;

  public sourceArtifact: Artifact;

  public buildArtifact: Artifact;

  public pipeline: Pipeline;

  constructor(scope: Construct, id: string, props: CodepipelineProps) {
    super(scope, id);

    const synthArtifact = new Artifact('synth');
    this.synthArtifact = synthArtifact;
    const buildArtifact = new Artifact('build');
    this.buildArtifact = buildArtifact;
    this.sourceArtifact = props.sourceArtifact;

    const encryptionKey = new Key(this, 'ArtifactBucketKey', {
      pendingWindow: Duration.days(10),
      keyUsage: KeyUsage.ENCRYPT_DECRYPT,
      enableKeyRotation: true,
      description: `VW managed key used to encrypt Artifact Bucket for ${props.microservice.name}`,
    })

    const artifactBucket = new Bucket(this, 'ArtifactBucket', {
      bucketName:`${props.stage.toLowerCase()}-${props.microservice.name.toLowerCase()}-pipelineartifactbucket`,
      encryptionKey,
      removalPolicy: RemovalPolicy.DESTROY,
      enforceSSL: true,
    })

    Tags.of(artifactBucket).add('can-delete', 'false')

    this.pipeline = new Pipeline(this, 'Pipeline', {
      pipelineName: `${props.microservice.name}Pipeline`,
      crossAccountKeys: false,
      restartExecutionOnUpdate: false,
      artifactBucket,
      stages: [
        {
          stageName: 'Source',
          actions: [props.sourceAction],
        },
        {
          stageName: 'CdkBuild',
          actions: [
            this.createBuildAction(1, 'Build', props.synthProject, props.sourceArtifact, [synthArtifact]),
          ],
        },
        {
          stageName: 'AppBuild',
          actions: [
            this.createBuildAction(1, 'Build', props.buildProject, props.sourceArtifact, [buildArtifact]),
          ],
        },
      ]
    })
  }

  /**
   * Creates a new CodeBuild Action for a given project. Needs to be attached to an action in a stage.
   * <br/>
   *
   * @param runOrder
   *      The runOrder property for this Action. RunOrder determines the relative order in which multiple Actions in the same Stage execute.
   * @param name
   *      The physical, human-readable name of the Action. Note that Action names must be unique within a single Stage
   * @param project
   *      The action's Project.
   * @param sourceArtifact
   *      The source to use as input for this action.
   * @param outputs
   *       The list of output Artifacts for this action.
   *
   * @example
   *       this.createBuildAction(1, 'Build', props.synthProject, props.sourceArtifact, [synthArtifact]),
   */
  private createBuildAction(runOrder: number, name: string, project: IProject, sourceArtifact: Artifact, outputs?: Artifact[]) {
    return new CodeBuildAction({
      runOrder: runOrder,
      actionName: name,
      project: project,
      input: sourceArtifact,
      outputs: outputs,
    });
  }

  /**
   * Add a stage with a given action array
   * <br/>
   *
   * @param stageName
   *      Name given to the stage.
   * @param actions
   *      Array of CodeBuildActions
   * @param placement
   *      Allows you to control where to place a new Stage when it's added to the Pipeline.
   *      Note that you can provide only one of the below properties - specifying more than one will result in a validation error.
   *      @see #rightBefore
   *      @see #justAfter
   *
   * @example
   *      const lambdaAction = new Function(...);
   *
   *      const pipeline = new CustomCodepipeline(...);
   *
   *      const lambdaAction = new LambdaInvokeAction({
   *         actionName: 'Lambda',
   *         lambda: fn,
   *       });
   *
   *      pipeline.addNormalStage({
   *        stageName: 'Lambda',
   *         actions: [lambdaAction],
   *      });
   */
  addNormalStage(stageName: string, actions: CodeBuildAction[], placement?: StagePlacement) {
    return this.pipeline.addStage({
      stageName,
      actions: actions,
      placement,
    })
  }

  /**
   * Add a stage with a given action array
   * <br/>
   *
   * @param stageName
   *      Name given to the stage.
   * @param runOrder
   * @param name
   * @param projects
   * @param outputs
   * @param placement
   *      Allows you to control where to place a new Stage when it's added to the Pipeline.
   *      Note that you can provide only one of the below properties - specifying more than one will result in a validation error.
   *      @see #rightBefore
   *      @see #justAfter
   *
   * @example
   *      const lambdaAction = new Function(...);
   *
   *      const pipeline = new CustomCodepipeline(...);
   *
   *      const lambdaAction = new LambdaInvokeAction({
   *         actionName: 'Lambda',
   *         lambda: fn,
   *       });
   *
   *      pipeline.addNormalStage({
   *        stageName: 'Lambda',
   *         actions: [lambdaAction],
   *      });
   *
   * @see #createBuildAction
   */
  addBuildStage(stageName: string, runOrder: number, name: string, projects: IProject[], outputs?: Artifact[], placement?: StagePlacement ) {
    let actions: CodeBuildAction[] = []

    projects.forEach((project => {
      const action = this.createBuildAction(runOrder, name, project, this.sourceArtifact, outputs)
      actions.push(action)
    }))

    return this.pipeline.addStage({
      stageName,
      actions: actions,
      placement,
    })
  }

  /**
   * Add a stage that deploys to a specified ECS service
   * <br/>
   *
   * @param stageName
   *      Name given to the stage.
   * @param actionName
   *      Name given to the action
   * @param service
   *      Target fargate service for deployment
   * @param placement
   *      Allows you to control where to place a new Stage when it's added to the Pipeline.
   *      Note that you can provide only one of the below properties - specifying more than one will result in a validation error.
   *      @see #rightBefore
   *      @see #justAfter
   *
   * @example
   *    const pipeline = new CustomCodepipeline(...)
   *
   *    const service = BaseService.fromServiceArnWithCluster(...)
   *
   *    pipeline.addEcsDeployment(
   *       'DeployToAcademy',
   *         'DeployECS',
   *         service,
   *     )
   */
  addEcsDeployment(stageName:string, actionName: string, service: IBaseService, placement?: StagePlacement) {
    const deployAction = new EcsDeployAction({
      actionName,
      service: service,
      imageFile: new ArtifactPath(this.buildArtifact, `imagedefinitions.json`)
    });

    return this.pipeline.addStage({
      stageName,
      actions: [deployAction],
      placement,
    })
  }

  /**
   * Adds a manual approval button.
   * <br/>
   *
   * @param stageName
   *      Name given to the stage.
   * @param placement
   *      Allows you to control where to place a new Stage when it's added to the Pipeline.
   *      Note that you can provide only one of the below properties - specifying more than one will result in a validation error.
   *      @see #rightBefore
   *      @see #justAfter
   *
   * @example
   *      const pipeline = new CustomCodepipeline(...);
   *
   *      const service = BaseService.fromServiceArnWithCluster(...)
   *
   *      const deployEcs = pipeline.addEcsDeployment(
   *       'DeployToAcademy',
   *         'DeployECS',
   *         service,
   *      );
   *
   *      const manualPlacement: StagePlacement = {
   *       justAfter: deployEcs
   *      };
   *
   *      pipeline.addManualApproval(
   *        'ApprovalStage',
   *        deployEcs
   *      );
   */
  addManualApproval(stageName: string, placement: StagePlacement) {
    const action = new ManualApprovalAction({
      actionName: 'ManualApproval',
      runOrder: 1,
      additionalInformation: 'Please review and approve the deployment.',
    });

    return this.pipeline.addStage({
      stageName,
      actions: [action],
      placement
    })
  }
}



