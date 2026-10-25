import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type RootParamList = {
  Welcome: undefined; SignIn: undefined;
  Tasks: undefined;
  Profile: { segment?: 'Payouts' | 'Submissions' | 'Ledger' } | undefined;
  TaskDetail: { orderId?: string } | undefined;
  Capture: { consented: boolean; orderId?: string };
  Submission: { submissionId: string };
};
export type RootProps<T extends keyof RootParamList> = NativeStackScreenProps<RootParamList, T>;
