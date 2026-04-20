#!/bin/bash
# repo-study-status.sh - 检查 study 项目状态
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
META_FILE="$PROJECT_DIR/.study-meta.json"

# 参数解析
JSON_OUTPUT=false
CHECK_REMOTE=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --json) JSON_OUTPUT=true; shift ;;
    --check-remote) CHECK_REMOTE=true; shift ;;
    *) shift ;;
  esac
done

# 基础检测
DIR_NAME="$(basename "$PROJECT_DIR")"
NAME_ENDS_WITH_STUDY="no"
[[ "$DIR_NAME" == *-study ]] && NAME_ENDS_WITH_STUDY="yes"

HAS_META="no"
[[ -f "$META_FILE" ]] && HAS_META="yes"

PROJECT_ORIGIN="unknown"
CREATED_BY_REPO_STUDY="no"
if [[ -f "$META_FILE" ]]; then
  SKILL=$(jq -r '.managedBy.skill // "unknown"' "$META_FILE")
  CREATED=$(jq -r '.managedBy.createdBySkill // false' "$META_FILE")
  if [[ "$SKILL" == "repo-study" ]]; then
    PROJECT_ORIGIN="repo-study-managed"
    CREATED_BY_REPO_STUDY="yes"
  else
    PROJECT_ORIGIN="non-repo-study"
  fi
fi

# 远程版本检查
REMOTE_STATUS="unknown"
LOCAL_SHA=""
REMOTE_SHA=""
if [[ "$CHECK_REMOTE" == true && -f "$META_FILE" ]]; then
  LOCAL_SHA=$(jq -r '.repo.commitSha // empty' "$META_FILE")
  REPO_OWNER=$(jq -r '.repo.owner // empty' "$META_FILE")
  REPO_NAME=$(jq -r '.repo.name // empty' "$META_FILE")
  REPO_BRANCH=$(jq -r '.repo.branch // "main"' "$META_FILE")

  if [[ -n "$REPO_OWNER" && -n "$REPO_NAME" ]]; then
    REMOTE_SHA=$(gh api "repos/${REPO_OWNER}/${REPO_NAME}/commits/${REPO_BRANCH}" --jq '.sha' 2>/dev/null || echo "")
    if [[ -n "$REMOTE_SHA" && -n "$LOCAL_SHA" ]]; then
      if [[ "$REMOTE_SHA" == "$LOCAL_SHA" ]]; then
        REMOTE_STATUS="up-to-date"
      else
        REMOTE_STATUS="outdated"
      fi
    fi
  fi
fi

# Topics 统计
TOPIC_COUNT=0
QUESTION_COUNT=0
NOTE_COUNT=0
GUIDE_COUNT=0
SKILL_TEMPLATE_COUNT=0
RUNNABLE_SKILL_COUNT=0

if [[ -f "$META_FILE" ]]; then
  TOPIC_COUNT=$(jq '.topics | length' "$META_FILE")
  QUESTION_COUNT=$(jq '[.topics[].progress.questionCount // 0] | add // 0' "$META_FILE")
  NOTE_COUNT=$(jq '[.topics[].progress.noteCount // 0] | add // 0' "$META_FILE")
  GUIDE_COUNT=$(jq '[.topics[].progress.guideCount // 0] | add // 0' "$META_FILE")
  SKILL_TEMPLATE_COUNT=$(jq '[.topics[].progress.skillTemplateCount // 0] | add // 0' "$META_FILE")
  RUNNABLE_SKILL_COUNT=$(jq '[.topics[].progress.runnableSkillCount // 0] | add // 0' "$META_FILE")
fi

# 输出
if [[ "$JSON_OUTPUT" == true ]]; then
  jq -n \
    --arg dir "$PROJECT_DIR" \
    --arg name_study "$NAME_ENDS_WITH_STUDY" \
    --arg has_meta "$HAS_META" \
    --arg origin "$PROJECT_ORIGIN" \
    --arg created "$CREATED_BY_REPO_STUDY" \
    --arg remote_status "$REMOTE_STATUS" \
    --arg local_sha "$LOCAL_SHA" \
    --arg remote_sha "$REMOTE_SHA" \
    --argjson topics "$TOPIC_COUNT" \
    --argjson questions "$QUESTION_COUNT" \
    --argjson notes "$NOTE_COUNT" \
    --argjson guides "$GUIDE_COUNT" \
    --argjson skill_templates "$SKILL_TEMPLATE_COUNT" \
    --argjson runnable_skills "$RUNNABLE_SKILL_COUNT" \
    '{
      currentDir: $dir,
      checks: { nameEndsWithStudy: ($name_study == "yes"), hasStudyMeta: ($has_meta == "yes") },
      projectOrigin: $origin,
      createdByRepoStudy: ($created == "yes"),
      remoteCheck: {
        enabled: true,
        status: $remote_status,
        localCommitSha: $local_sha,
        remoteCommitSha: $remote_sha,
        updateRecommended: ($remote_status == "outdated")
      },
      summary: {
        topicCount: $topics,
        questionCount: $questions,
        noteCount: $notes,
        guideCount: $guides,
        skillTemplateCount: $skill_templates,
        runnableSkillCount: $runnable_skills
      }
    }'
else
  echo "Repo Study Status"
  echo "Current Directory: $PROJECT_DIR"
  echo "Directory Suffix (*-study): $NAME_ENDS_WITH_STUDY"
  echo "Study Meta (.study-meta.json): $HAS_META"
  echo "Project Origin: $PROJECT_ORIGIN"
  echo "Created By repo-study: $CREATED_BY_REPO_STUDY"
  if [[ "$CHECK_REMOTE" == true ]]; then
    echo "Remote Check: $REMOTE_STATUS"
    echo "Local Commit: ${LOCAL_SHA:0:8}"
    echo "Remote Commit: ${REMOTE_SHA:0:8}"
  fi
  echo ""
  echo "Topics: $TOPIC_COUNT"
fi
