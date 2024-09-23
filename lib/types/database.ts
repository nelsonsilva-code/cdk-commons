import {DatabaseCluster, DatabaseClusterFromSnapshot, DatabaseInstance} from "aws-cdk-lib/aws-rds";

export type DatabaseEngine = 'AuroraMySql' | 'Postgres' | undefined

//Type guards
export function isDatabaseInstance(database: any): database is DatabaseInstance {
    return (database as DatabaseInstance).instanceEndpoint !== undefined;
}

export function isDatabaseClusterFromSnapshot(database: any): database is DatabaseClusterFromSnapshot {
    return (database as DatabaseClusterFromSnapshot).instanceEndpoints !== undefined;
}

export function isDatabaseCluster(database: any): database is DatabaseCluster {
    return (database as DatabaseCluster).clusterEndpoint !== undefined;
}