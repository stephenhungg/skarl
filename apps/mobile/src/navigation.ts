import type { NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';

export type TabParamList = { Tasks: undefined; CaptureTab: undefined; Profile: { segment?: 'Payouts' | 'Submissions' | 'Ledger' } | undefined };
export type RootParamList = {
  Welcome: undefined; Email: undefined;
  Tabs: NavigatorScreenParams<TabParamList>;
  TaskDetail: undefined;
  Capture: { consented: boolean };
  Submission: { submissionId: string };
};
export type RootProps<T extends keyof RootParamList> = NativeStackScreenProps<RootParamList, T>;
export type TabProps<T extends keyof TabParamList> = CompositeScreenProps<BottomTabScreenProps<TabParamList, T>, NativeStackScreenProps<RootParamList, keyof RootParamList>>;
