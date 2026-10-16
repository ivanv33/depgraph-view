import type { Plan, PlanNode, Status } from '../schema.js'

/**
 * A cross-linked plan's shape (ids, needs and states only; neutral titles): one goal, four areas under it and 48
 * features, 40 of them done, many needed by two or three areas. Used to check that folding keeps the overview compact.
 */
const n = (id: string, status: Status, depends_on: string[], k: number): PlanNode => ({ id, title: `Step ${k}`, description: '', status, tags: [], depends_on })

export const crossLinkedPlan: Plan = {
  name: 'Cross linked',
  nodes: [
    n('add-steps', 'done', [], 1),
    n('arrow-key-walk', 'done', ['camera', 'edit-selected-step'], 2),
    n('camera', 'done', ['decks'], 3),
    n('chat', 'done', [], 4),
    n('chat-modes', 'done', ['chat', 'cli-login'], 5),
    n('cli-login', 'done', ['chat', 'suggest'], 6),
    n('closer-is-larger', 'done', ['camera', 'due-dates'], 7),
    n('decks', 'done', ['layered-layout', 'round-nodes'], 8),
    n('depgraph', 'doing', ['keep-the-data', 'view-the-graph', 'shape-the-plan', 'think-aloud'], 9),
    n('due-dates', 'done', [], 10),
    n('edit-selected-step', 'done', [], 11),
    n('fit-all-key', 'done', ['camera'], 12),
    n('haze', 'done', ['due-dates'], 13),
    n('hold', 'done', [], 14),
    n('inherited-due', 'done', ['closer-is-larger', 'due-dates', 'node-folders'], 15),
    n('jump-to-step', 'done', ['camera'], 16),
    n('keep-the-data', 'doing', ['esc-back-to-card', 'local-only', 'node-folders', 'plan-files', 'step-cards'], 17),
    n('layered-layout', 'done', [], 18),
    n('link-steps', 'done', [], 19),
    n('local-only', 'done', [], 20),
    n('merged-panel', 'done', ['chat-modes', 'node-folders'], 21),
    n('node-folders', 'done', ['plan-files', 'research-notes', 'step-cards'], 22),
    n('partial-deck', 'doing', ['decks'], 23),
    n('plan-files', 'done', [], 24),
    n('readiness-chains', 'done', [], 25),
    n('ready-now-list', 'todo', ['readiness-chains'], 26),
    n('research-notes', 'done', ['step-cards'], 27),
    n('review-accept-all', 'todo', ['camera', 'suggest'], 28),
    n('round-nodes', 'done', ['layered-layout'], 29),
    n('view-the-graph', 'doing', ['camera', 'click-right-step', 'closer-is-larger', 'deck-honest-counts', 'decks', 'done-steps-grouped', 'fit-all-key', 'frame-follows-edits', 'haze', 'inherited-size-cap', 'jump-to-step', 'layered-layout', 'narrow-panel-overlay', 'partial-deck', 'readiness-chains', 'ready-now-list', 'resize-reframes', 'round-nodes', 'size-and-colour', 'titles-never-collide', 'wheel-over-steps'], 30),
    n('shape-the-plan', 'doing', ['add-steps', 'arrow-key-walk', 'delete-toast', 'due-dates', 'edit-selected-step', 'hold', 'inherited-due', 'link-steps', 'merged-panel', 'one-date-format', 'start-from-goal', 'undo-redo', 'warn-open-needs'], 31),
    n('situation-note', 'done', [], 32),
    n('size-and-colour', 'done', ['due-dates', 'round-nodes'], 33),
    n('start-from-goal', 'done', [], 34),
    n('step-cards', 'done', ['plan-files'], 35),
    n('suggest', 'done', ['hold', 'situation-note'], 36),
    n('think-aloud', 'doing', ['chat', 'chat-modes', 'cli-login', 'drafts-per-step', 'research-notes', 'review-accept-all', 'save-file-inline', 'situation-note', 'suggest'], 37),
    n('undo-redo', 'done', [], 38),
    n('warn-open-needs', 'todo', ['edit-selected-step', 'readiness-chains'], 39),
    n('click-right-step', 'done', [], 40),
    n('wheel-over-steps', 'done', [], 41),
    n('frame-follows-edits', 'done', [], 42),
    n('titles-never-collide', 'todo', [], 43),
    n('inherited-size-cap', 'todo', [], 44),
    n('one-date-format', 'done', [], 45),
    n('drafts-per-step', 'done', [], 46),
    n('esc-back-to-card', 'done', [], 47),
    n('delete-toast', 'done', [], 48),
    n('save-file-inline', 'done', [], 49),
    n('deck-honest-counts', 'doing', [], 50),
    n('narrow-panel-overlay', 'todo', [], 51),
    n('done-steps-grouped', 'done', ['decks'], 52),
    n('resize-reframes', 'done', ['camera', 'frame-follows-edits'], 53),
  ],
}

export const CROSS_GOAL = 'depgraph'
export const CROSS_AREAS = ['keep-the-data', 'view-the-graph', 'shape-the-plan', 'think-aloud']
