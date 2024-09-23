import {PipelineProject} from 'aws-cdk-lib/aws-codebuild';

export interface BuildProject extends PipelineProject {}

export interface SynthProject extends PipelineProject {}
