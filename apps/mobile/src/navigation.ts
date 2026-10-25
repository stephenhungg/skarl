import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type RootParamList = {
  Welcome: undefined; Email: undefined;
  Tasks: undefined;
  Profile: { segment?: 'Payouts' | 'Submissions' | 'Ledger' } | undefined;
  TaskDetail: undefined;
  Capture: { consented: boolean };
  Submission: { submissionId: string };
};
export type RootProps<T extends keyof RootParamList> = NativeStackScreenProps<RootParamList, T>;
