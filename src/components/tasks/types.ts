import type { Database } from '@/lib/supabase/database.types';

export type TaskStatus = Database['public']['Enums']['task_status'];
export type Priority = Database['public']['Enums']['priority_level'];
