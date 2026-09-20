export const GROUPS = Object.freeze(['Alpha', 'Bravo', 'Charlie']);

const groups = {
  Alpha: { name: 'Alpha', className: 'group-alpha', color: '#64a5fa' },
  Bravo: { name: 'Bravo', className: 'group-bravo', color: '#ffb15b' },
  Charlie: { name: 'Charlie', className: 'group-charlie', color: '#c19aff' },
};
const unassigned = { name: 'Unassigned', className: 'group-unassigned', color: '#a2b0b9' };

export function groupInfo(group) {
  return GROUPS.includes(group) ? groups[group] : unassigned;
}
