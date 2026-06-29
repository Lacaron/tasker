const https = require('https')
const { URL } = require('url')
const { buildComment, parseComment, MARKER } = require('./commentUtils')

/**
 * Jira REST API v3 connector for Tasker.
 *
 * Transport copied from the working jira-helper app: uses Node's built-in
 * `https` module from the Electron main process (not fetch), so corp SSL
 * inspection certificates don't break requests when combined with
 * NODE_TLS_REJECT_UNAUTHORIZED=0 (set in main.js).
 *
 * Connector interface matches src/connectors/connector.interface.js:
 *   testConnection, fetchTasks, createTask, getRemoteCommentMeta, pushUpdate.
 */
function makeJiraConnector(config) {
  const { baseUrl, email, apiToken, jql, projectKey, issueType } = config
  const credentials = Buffer.from(`${email}:${apiToken}`).toString('base64')

  function request(method, apiPath, body = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(`${baseUrl}/rest/api/3${apiPath}`)
      const bodyStr = body ? JSON.stringify(body) : null
      const options = {
        hostname: url.hostname,
        port:     url.port || 443,
        path:     url.pathname + url.search,
        method,
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Accept':        'application/json',
          'Content-Type':  'application/json',
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        },
      }

      const req = https.request(options, (res) => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
          let parsed = null
          try { parsed = data ? JSON.parse(data) : null } catch { parsed = data }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed)
          } else {
            reject(new Error(`Jira ${method} ${apiPath} → ${res.statusCode}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`))
          }
        })
      })
      req.on('error', reject)
      if (bodyStr) req.write(bodyStr)
      req.end()
    })
  }

  function buildAdfBody(text) {
    const paragraphs = text.split('\n').map(line => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    }))
    return { version: 1, type: 'doc', content: paragraphs }
  }

  function extractCommentText(comment) {
    if (!comment) return ''
    if (typeof comment.body === 'string') return comment.body
    try {
      const walk = (node) => {
        if (!node) return ''
        if (node.type === 'text') return node.text || ''
        if (node.type === 'hardBreak') return '\n'
        const children = (node.content || []).map(walk).join('')
        if (node.type === 'paragraph' || node.type === 'heading') return children + '\n'
        return children
      }
      const content = comment.body?.content || []
      return content.map(walk).join('')
    } catch {
      return ''
    }
  }

  function findManagedComment(comments) {
    const matches = (comments || []).filter(c => extractCommentText(c).includes(MARKER))
    if (matches.length <= 1) return matches[0]
    // Multiple managed comments (legacy duplicates) → pick the most recently updated one
    return matches.slice().sort((a, b) => (b.updated || '').localeCompare(a.updated || ''))[0]
  }

  function issueToTask(issue, comment) {
    const commentText = comment ? extractCommentText(comment) : ''
    const parsed = parseComment(commentText)
    const now = new Date().toISOString()
    return {
      id: issue.key,
      type: 'main',
      parentId: null,
      subtasks: parsed.subtasks,
      title: issue.fields.summary,
      text: parsed.text,
      status: issue.fields.status?.name || '',
      // Due date is sourced from the managed comment header, not Jira's native duedate field.
      dueDate: parsed.dueDate || null,
      done: false,
      tags: parsed.tags,
      externalLink: `${baseUrl}/browse/${issue.key}`,
      recurring: parsed.recurring,
      connector: {
        type: 'jira',
        externalId: issue.key,
        commentId: comment?.id || null,
        commentUpdatedAt: comment?.updated || now,
      },
    }
  }

  return {
    async testConnection() {
      await request('GET', '/myself')
      return true
    },

    async fetchTasks() {
      const data = await request('POST', '/search/jql', {
        jql,
        fields: ['summary', 'status'],
        maxResults: 100,
      })
      const issues = data.issues || []
      const tasks = []
      for (const issue of issues) {
        const commentsData = await request('GET', `/issue/${issue.key}/comment?maxResults=100`)
        const managed = findManagedComment(commentsData.comments)
        tasks.push(issueToTask(issue, managed))
      }
      return tasks
    },

    async createTask(title, dueDate) {
      // Note: dueDate is stored in the managed comment header, NOT in Jira's native duedate.
      const created = await request('POST', '/issue', {
        fields: {
          project:   { key: projectKey },
          summary:   title,
          issuetype: { name: issueType },
        },
      })
      const task = {
        id: created.key,
        type: 'main',
        parentId: null,
        subtasks: [],
        title,
        text: '',
        dueDate: dueDate || null,
        done: false,
        tags: [],
        externalLink: `${baseUrl}/browse/${created.key}`,
        recurring: null,
        connector: {
          type: 'jira',
          externalId: created.key,
          commentId: null,
          commentUpdatedAt: new Date().toISOString(),
        },
      }
      const adfBody = buildAdfBody(buildComment(task))
      const comment = await request('POST', `/issue/${created.key}/comment`, { body: adfBody })
      task.connector.commentId = comment.id
      task.connector.commentUpdatedAt = comment.updated
      return task
    },

    async getRemoteCommentMeta(task) {
      const { externalId, commentId } = task.connector
      if (!commentId) {
        return { updatedAt: new Date(0).toISOString(), body: '' }
      }
      const comment = await request('GET', `/issue/${externalId}/comment/${commentId}`)
      return {
        updatedAt: comment.updated,
        body: extractCommentText(comment),
      }
    },

    async fetchTransitions(key) {
      const data = await request('GET', `/issue/${key}/transitions`)
      return (data.transitions || []).map(t => ({
        id: t.id,
        name: t.name,
        to: t.to?.name || '',
      }))
    },

    async transitionIssue(key, transitionId) {
      await request('POST', `/issue/${key}/transitions`, { transition: { id: transitionId } })
      // Read back the new status so the renderer can show it
      const data = await request('GET', `/issue/${key}?fields=status`)
      return data.fields?.status?.name || ''
    },

    async pushUpdate(task) {
      const { externalId, commentId } = task.connector

      // Push only the summary to Jira's native fields. dueDate is persisted
      // in the managed comment header instead, per user preference.
      await request('PUT', `/issue/${externalId}`, {
        fields: { summary: task.title },
      })

      const adfBody = buildAdfBody(buildComment(task))
      let updatedComment
      if (commentId) {
        updatedComment = await request('PUT', `/issue/${externalId}/comment/${commentId}`, { body: adfBody })
      } else {
        updatedComment = await request('POST', `/issue/${externalId}/comment`, { body: adfBody })
        task.connector.commentId = updatedComment.id
      }
      return { updatedAt: updatedComment.updated }
    },
  }
}

module.exports = { makeJiraConnector }
