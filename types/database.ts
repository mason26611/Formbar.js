// Database row interfaces matching the SQLite schema

export interface UserRow {
    id: number;
    email: string;
    password: string | null;
    permissions: number;
    role: string | null;
    API: string;
    secret: string;
    tags: string | null;
    digipogs: number;
    displayName: string | null;
    verified: number;
    pin: string | null;
}

export interface RefreshTokenRow {
    user_id: number;
    token_hash: string;
    exp: number;
    token_type: "auth" | "oauth";
}

export interface ClassroomRow {
    id: number;
    name: string;
    owner: number;
    key: number;
    tags: string | null;
    settings: string | null;
}

export interface ClassPermissionsRow {
    classId: number;
    manageClass: number;
    manageStudents: number;
    controlPoll: number;
    votePoll: number;
    seePoll: number;
    breakHelp: number;
    auxiliary: number;
    links: number;
    userDefaults: number;
}

export interface ClassUserRow {
    classId: number;
    studentId: number;
    permissions: number | null;
    role: string | null;
    tags: string | null;
}

export interface CustomPollRow {
    id: number;
    owner: string | null;
    name: string | null;
    prompt: string | null;
    answers: string;
    textRes: number;
    blind: number;
    allowVoteChanges: number;
    allowMultipleResponses: number;
    weight: number;
    public: number;
}

export interface PollAnswerRow {
    pollId: number;
    classId: number;
    userId: number;
    buttonResponse: string | null;
    textResponse: string | null;
    createdAt: number | null;
}

export interface PollHistoryRow {
    id: number;
    class: number;
    prompt: string | null;
    responses: string | null;
    allowMultipleResponses: number;
    blind: number;
    allowTextResponses: number;
    createdAt: number;
}

export interface TransactionRow {
    from_id: number;
    to_id: number;
    from_type: "user" | "pool";
    to_type: "user" | "pool";
    amount: number;
    reason: string;
    date: string;
}

export interface DigipogPoolRow {
    id: number;
    name: string;
    description: string;
    amount: number;
}

export interface DigipogPoolUserRow {
    pool_id: number;
    user_id: number;
    owner: number;
}

export interface ClassPollRow {
    pollId: number;
    classId: number;
}

export interface SharedPollRow {
    pollId: number;
    userId: number;
}

export interface RoleRow {
    id: number;
    name: string;
    classId: number | null;
    scopes: string;
}

export interface UserRoleRow {
    userId: number;
    roleId: number;
    classId: number | null;
}

export interface LinkRow {
    id: number;
    name: string;
    url: string;
    classId: number;
}

export interface InventoryRow {
    id: number;
    user_id: number;
    item_id: number;
    quantity: number;
}

export interface ItemRegistryRow {
    id: number;
    name: string;
    description: string | null;
    stack_size: number;
    image_url: string | null;
}

export interface TradeRow {
    id: number;
    from_user: number;
    to_user: number;
    offered_items: string;
    requested_items: string;
    status: "pending" | "accepted" | "rejected";
    created_at: string;
    updated_at: string;
}

export interface NotificationRow {
    id: number;
    user_id: number;
    type: string;
    data: string | null;
    is_read: number;
    created_at: string;
}

export interface AppRow {
    id: number;
    name: string;
    description: string | null;
    owner_user_id: number;
    share_item_id: number;
    pool_id: number;
    api_key_hash: string;
    api_secret_hash: string;
}

export interface UsedAuthorizationCodeRow {
    code_hash: string;
    used_at: number;
    expires_at: number;
}

export interface IpAccessListRow {
    id: number;
    ip: string;
    is_whitelist: number;
}

export interface TempUserCreationDataRow {
    token: string;
    secret: string | null;
}
