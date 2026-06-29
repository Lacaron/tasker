/**
 * @typedef {Object} Subtask
 * @property {string} id
 * @property {string} title
 * @property {string|null} dueDate  YYYY-MM-DD
 * @property {boolean} done
 */

/**
 * @typedef {Object} RecurringConfig
 * @property {boolean} enabled
 * @property {'day'|'week'|'month'} unit
 * @property {number} interval
 */

/**
 * @typedef {Object} ConnectorMeta
 * @property {'jira'|'mock'} type
 * @property {string} externalId
 * @property {string|null} commentId
 * @property {string|null} commentUpdatedAt  ISO timestamp of last known comment state
 */

/**
 * @typedef {Object} Task
 * @property {string} id
 * @property {'main'|'sub'} type
 * @property {string|null} parentId
 * @property {Subtask[]} subtasks
 * @property {string} title
 * @property {string} text             markdown log body
 * @property {string|null} dueDate     YYYY-MM-DD
 * @property {boolean} done
 * @property {string[]} tags
 * @property {string|null} externalLink
 * @property {RecurringConfig|null} recurring
 * @property {ConnectorMeta} connector
 */

/**
 * @typedef {Object} RemoteCommentMeta
 * @property {string} updatedAt  ISO timestamp
 * @property {string} body       raw comment text
 */

/**
 * @typedef {Object} TaskConnector
 * @property {() => Promise<boolean>} testConnection
 * @property {() => Promise<Task[]>} fetchTasks
 * @property {(title: string, dueDate: string|null) => Promise<Task>} createTask
 * @property {(task: Task) => Promise<RemoteCommentMeta>} getRemoteCommentMeta
 * @property {(task: Task) => Promise<void>} pushUpdate
 */

module.exports = {}
