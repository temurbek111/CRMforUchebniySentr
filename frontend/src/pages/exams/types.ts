/**
 * Exams / Results / Progress module types.
 *
 * Mirrors apps/exams/serializers.py, apps/exams/services.py (mark sheet and
 * reporting payloads), apps/academics/serializers.py (groups, students) and
 * apps/reporting/services.py (at-risk). Every percentage, grade, pass flag and
 * trend string here is produced by the server.
 */

/** apps/exams/models.py ExamType - the values the API accepts. */
export type ExamTypeValue =
  | 'quiz'
  | 'monthly_test'
  | 'midterm'
  | 'final'
  | 'mock_exam'
  | 'placement_test'
  | 'custom';

export const EXAM_TYPE_VALUES: ReadonlyArray<ExamTypeValue> = [
  'quiz',
  'monthly_test',
  'midterm',
  'final',
  'mock_exam',
  'placement_test',
  'custom',
];

export interface ExamComponent {
  id: number;
  exam: number;
  name: string;
  max_score: string;
  order: number;
}

/** POST /api/exams/ `components[]` entry. */
export interface ExamComponentInput {
  name: string;
  max_score: string;
  order: number;
}

/** GET /api/exams/ row (ExamSerializer). */
export interface Exam {
  id: number;
  group: number;
  group_name: string;
  course: number | null;
  course_name: string;
  teacher: number | null;
  teacher_name: string;
  name: string;
  exam_type: string;
  exam_type_display: string;
  date: string;
  max_score: string;
  passing_score: string;
  passing_percentage: string;
  description: string;
  is_published: boolean;
  components: ExamComponent[];
  components_count: number;
  results_count: number;
  created_at: string;
}

export interface ExamWritePayload {
  group: number;
  name: string;
  exam_type: ExamTypeValue;
  date: string;
  course?: number | null;
  teacher?: number | null;
  max_score?: string;
  passing_score?: string | null;
  description?: string;
  components?: ExamComponentInput[];
}

/** One student's row of the mark sheet (GET /api/exams/{id}/results/). */
export interface MarkSheetStudent {
  student: number;
  student_name: string;
  student_code: string;
  /** Component name -> score string. Empty for a simple (component-less) exam. */
  scores: Record<string, string>;
  overall_score: string;
  overall_percentage: string;
  grade: string;
  passed: boolean;
  comment: string;
}

export interface ExamStatistics {
  average_percentage: string;
  highest_percentage: string;
  lowest_percentage: string;
  pass_rate: string;
  passed_count: number;
  failed_count: number;
  below_passing: Array<{ student: number; student_name: string; percentage: string }>;
}

export interface ExamResultsSummary {
  exam: {
    id: number;
    name: string;
    type: string;
    date: string;
    group_name: string;
    course_name: string;
    max_score: string;
    passing_score: string;
  };
  components: ExamComponent[];
  students: MarkSheetStudent[];
  statistics: ExamStatistics;
}

/** POST /api/exams/{id}/results/ entry. */
export interface ResultEntry {
  student: number;
  component?: number | null;
  score: string;
  teacher_comment?: string;
}

/** GET /api/results/ row (ExamResultSerializer). */
export interface ExamResultRow {
  id: number;
  exam: number;
  exam_name: string;
  component: number | null;
  component_name: string;
  student: number;
  student_name: string;
  student_code: string;
  score: string;
  max_score: string | null;
  percentage: string;
  grade: string;
  teacher_comment: string;
  marked_by: number | null;
  marked_by_name: string;
  created_at: string;
}

/** A student of a group (GroupMembershipSerializer subset). */
export interface GroupStudent {
  student: number;
  student_name: string;
  student_code: string;
}

/** GET /api/students/ row subset used by pickers. */
export interface StudentOption {
  id: number;
  full_name: string;
  code: string;
  group_name?: string;
}

/** One flat result inside a student's exam history. */
export interface StudentExamResult {
  id: number;
  exam: number;
  exam_name: string;
  type: string;
  date: string;
  group: number;
  group_name: string;
  component: number | null;
  component_name: string;
  score: string;
  max_score: string | null;
  percentage: string;
  grade: string;
  teacher_comment: string;
}

export interface StudentExamSummary {
  exams_taken: number;
  average_percentage: string;
  latest_score: string | null;
  latest_percentage: string | null;
  highest_percentage: string | null;
  lowest_percentage: string | null;
  pass_count: number;
  fail_count: number;
  /** improving | stable | declining | insufficient_data */
  trend: string;
  recent: StudentExamResult[];
}

/** GET /api/students/{id}/exams/ */
export interface StudentExamHistory {
  summary: StudentExamSummary;
  results: StudentExamResult[];
}

export interface GroupPerformanceExam {
  exam: number;
  exam_name: string;
  type: string;
  date: string;
  max_score: string;
  passing_score: string;
  results_count: number;
  average_percentage: string | null;
  pass_rate: string | null;
}

export interface GroupPerformanceStudent {
  student: number;
  student_name: string;
  student_code: string;
  exams_taken: number;
  average_percentage: string;
  passed: number;
  failed: number;
  /** improving | stable | declining | insufficient_data */
  trend: string;
}

/** GET /api/groups/{id}/performance/ */
export interface GroupPerformance {
  group: number;
  group_name: string;
  exams: GroupPerformanceExam[];
  average_percentage: string;
  pass_rate: string;
  students: GroupPerformanceStudent[];
  /** improving | stable | declining | insufficient_data */
  trend: string;
}

/** GET /api/at-risk/ row (reporting services.at_risk_students). */
export interface AtRiskStudent {
  student: number;
  student_name: string;
  student_code: string;
  status: string;
  attendance_pct: string | null;
  absences_this_month: number;
  overdue: { days: number; amount: string } | null;
  failed_exams: number;
  trend: string | null;
  /** critical | warning | info */
  severity: string;
  reasons: Array<{ code: string; label: string }>;
  link: string;
}

export interface GroupOption {
  id: number;
  name: string;
  course_name?: string;
  teacher_name?: string;
  student_count?: number;
  capacity?: number;
  status?: string;
}

export interface CourseOption {
  id: number;
  code: string;
  name: string;
  level?: string;
  status?: string;
}

export interface TeacherOption {
  id: number;
  full_name: string;
  status?: string;
}
