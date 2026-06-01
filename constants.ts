
import { RewardsConfig } from './types';

export const BRAND_LOGO_PATH = '/beta-logo.png';

export const REWARDS_CONFIG: RewardsConfig = {
  dailyLogin: 10,
  lessonCompletion: 50,
  quizPass: 100,
  assignmentSubmission: 150,
  creditsPerCurrencyUnit: 3000,
  currencyCode: 'USD'
};

export const SERVICES = [
  { title: 'Corporate Training', desc: 'Upskill your workforce with tailored programs.', icon: 'Building' },
  { title: 'K-12 Education', desc: 'Comprehensive curriculum for schools.', icon: 'GraduationCap' },
  { title: 'Certification', desc: 'Industry-recognized certificates upon completion.', icon: 'Award' },
  { title: 'Consulting', desc: 'Educational strategy and curriculum design.', icon: 'Briefcase' }
];
