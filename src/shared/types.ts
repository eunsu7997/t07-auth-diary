export interface PlanInput {
  title: string;
  period_start: string;
  period_end: string;
  success_criteria: string;
  estimated_seconds: number;
}
export interface PlanVersion extends PlanInput {
  plan_id: string;
  version: number;
  recorded_at: string;
}
export interface Plan extends PlanVersion {
  owner_user_id: string;
  id: string;
  current_version: number;
  created_at: string;
  updated_at: string;
}
export type Priority = 'high' | 'medium' | 'low';
export interface TaskInput {
  content: string;
  priority: Priority;
  due_date: string | null;
  estimated_seconds: number;
  tags: string[];
}
export interface Tag { id: string; name: string }
export interface Task extends Omit<TaskInput, 'tags'> {
  id: string;
  plan_id: string;
  status: 'in_progress' | 'completed';
  completed_at: string | null;
  copied_from_task_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  tags: Tag[];
}

export interface ExecutionLog {
  id: string;
  task_id: string;
  started_at: string;
  ended_at: string | null;
  actual_seconds: number | null;
  estimated_seconds_at_start: number;
  start_request_id: string;
  finish_request_id: string | null;
}
export interface CopyInput {
  plan: PlanInput;
  tasks: { task_id: string; due_date: string | null }[];
}
export interface Review {
  as_of: string;
  today: string;
  timezone: 'Asia/Seoul';
  plan_count: number;
  completed_count: number;
  delayed_count: number;
  plan_estimated_seconds: number;
  task_estimated_seconds: number;
  actual_seconds: number;
  difference_seconds: number;
  evidence: {
    plans: Plan[];
    tasks: Task[];
    completed_tasks: Task[];
    delayed_tasks: Task[];
    closed_executions: ExecutionLog[];
    active_executions: ExecutionLog[];
  };
}
export interface ExportTables {
  plans: Pick<Plan, 'owner_user_id' | 'id' | 'current_version' | 'created_at' | 'updated_at'>[];
  plan_versions: PlanVersion[];
  tasks: Omit<Task, 'tags'>[];
  tags: (Tag & { owner_user_id: string })[];
  task_tags: { task_id: string; tag_id: string }[];
  execution_logs: ExecutionLog[];
}
export interface DatabaseExport extends ExportTables {
  schema_version: '3.0.0';
  exported_at: string;
  timezone: 'Asia/Seoul';
  export_metadata: {
    application: 'aleph-t07-auth-diary';
    time_unit: 'seconds';
    consistency: 'transaction';
    table_counts: Record<keyof ExportTables, number>;
  };
}
