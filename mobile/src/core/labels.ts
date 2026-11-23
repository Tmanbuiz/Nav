import type { Leg } from './parser/assignmentParser';

export type LegChoice = 'to' | 'both' | 'from';

export function legsLabel(legs: Leg[]): string {
  const to = legs.includes('to-church');
  const from = legs.includes('from-church');
  if (to && from) return 'To church and back home';
  if (to) return 'To church only';
  if (from) return 'Home from church only';
  return 'Trips not chosen';
}

export function legsToChoice(legs: Leg[]): LegChoice {
  const to = legs.includes('to-church');
  const from = legs.includes('from-church');
  if (to && from) return 'both';
  if (from) return 'from';
  return 'to';
}

export function choiceToLegs(choice: LegChoice): Leg[] {
  if (choice === 'both') return ['to-church', 'from-church'];
  if (choice === 'from') return ['from-church'];
  return ['to-church'];
}
