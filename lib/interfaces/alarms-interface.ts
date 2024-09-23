import {ComparisonOperator, TreatMissingData} from "aws-cdk-lib/aws-cloudwatch";

export interface AlarmsInterface {
    addMonitor: boolean;
    period?: number,
    threshold?: number,
    evaluationPeriods?: number,
    datapointsToAlarm?: number,
    treatMissingData?: TreatMissingData,
    comparisonOperator?: ComparisonOperator
}