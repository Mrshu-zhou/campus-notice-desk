export type Role = "student" | "counselor";
export type SourceType = "wechat_group" | "dingtalk_or_wecom" | "email" | "paste";
export type Category = "fyi" | "action" | "needs_confirm";
export type TaskStatus = "todo" | "done";
export type AdapterType = "demo_seed" | "paste_import";
export type Relevance = "required" | "optional" | "conditional" | "unknown";
export type IgnoredReason = "chat" | "knowledge" | "acknowledgement" | "duplicate" | "unrelated" | "other";

export interface ThreadMessage {
  sender: string;
  time: string;
  text: string;
}

export interface SourceImage {
  id: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  data: string;
  name?: string;
  transcript?: string;
  uncertain?: boolean;
  notes?: string;
}

export interface ImageRead {
  imageId: string;
  text: string;
  uncertain: boolean;
  notes: string;
}

export interface ImageFailure {
  imageId: string | null;
  label: string;
  message: string;
}

export interface IgnoredItem {
  text: string;
  reason: IgnoredReason;
}

export interface Notice {
  id: string;
  role: Role;
  sourceType: SourceType;
  sourceLabel: string;
  title: string;
  body: string;
  receivedAt: string;
  read: boolean;
  adapter: AdapterType;
  thread?: ThreadMessage[];
  doNotExtract?: string[];
  screenshots?: SourceImage[];
  ignored?: IgnoredItem[];
  extraction?: {
    mode: ExtractionResult["mode"];
    returned: number;
    accepted: number;
  };
}

export interface Task {
  id: string;
  noticeId: string;
  role: Role;
  title: string;
  action: string;
  deadline: string | null;
  deadlineText: string | null;
  deadlineClock?: string | null;
  materials: string[];
  category: Category;
  status: TaskStatus;
  sourceQuote: string;
  sourceStart: number | null;
  sourceEnd: number | null;
  origin?: "verified_seed" | "cloud_agent" | "local_fixture" | "verified_offline";
  sourceImageId?: string | null;
  uncertainty?: string | null;
  relevance?: Relevance;
  location?: string | null;
  requirements?: string | null;
  reviewed?: boolean;
}

export interface PasteSample {
  id: string;
  role: Role;
  sourceType: SourceType;
  label: string;
  body: string;
  doNotExtract?: string[];
}

export type ReminderLead = "none" | "1d" | "2h" | "custom";

export interface ReminderState {
  at: string;
  lead: ReminderLead;
  notifiedAt?: string | null;
  acknowledgedAt?: string | null;
  postponedUntil?: string | null;
}

export interface TaskPatch {
  title?: string;
  action?: string;
  deadline?: string | null;
  deadlineText?: string | null;
  deadlineClock?: string | null;
  materials?: string[];
  category?: Category;
  uncertainty?: string | null;
  location?: string | null;
  requirements?: string | null;
  reviewed?: boolean;
}

export interface RoleState {
  read: Record<string, boolean>;
  done: Record<string, boolean>;
  deadlines: Record<string, string | null>;
  customNotices: Notice[];
  customTasks: Task[];
  demoComplete: boolean;
  tourDismissed: boolean;
  reminders: Record<string, ReminderState>;
  taskPatches: Record<string, TaskPatch>;
  hiddenNoticeIds: string[];
}

export interface ExtractionImage {
  id: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  data: string;
}

export interface ExtractionRequest {
  role: Role;
  today: string;
  sourceType: SourceType;
  body: string;
  images: ExtractionImage[];
}

export interface ExtractionTrace {
  requestMs: number;
  gateMs: number;
  returnedTasks: number;
  acceptedTasks: number;
  imageCount: number;
}

export interface ExtractionResult {
  tasks: Task[];
  mode: "cloud_agent" | "local_fixture" | "verified_offline";
  trace?: ExtractionTrace;
  imageReads: ImageRead[];
  ignored: IgnoredItem[];
}