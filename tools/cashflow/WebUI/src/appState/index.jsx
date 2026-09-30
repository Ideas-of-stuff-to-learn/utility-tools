import { AuthProvider } from './AuthContext';
import { BillingProvider } from './BillingContext';
import { ProcessingProvider } from './ProcessingContext';
import { TransactionsProvider } from './TransactionsContext';
import { ChartFilterProvider } from './ChartFilterContext';
import { UserPreferencesProvider } from './UserPreferencesContext';
import { UploadSessionProvider } from './UploadSessionContext';

export { useAuth } from './AuthContext';
export { useBilling } from './BillingContext';
export { useProcessing } from './ProcessingContext';
export { useTransactions } from './TransactionsContext';
export { useChartFilter } from './ChartFilterContext';
export { useUserPreferences } from './UserPreferencesContext';
export { useUploadSession } from './UploadSessionContext';

// Nesting order matters: inner providers may consume outer ones.
//   AuthProvider (no deps)
//     BillingProvider (consumes Auth — seeded from /auth/me billing field)
//       UserPreferencesProvider (consumes Auth for server hydration)
//         ProcessingProvider (no deps)
//           TransactionsProvider (consumes Auth, Processing, UserPreferences)
//             ChartFilterProvider (consumes Transactions)
//               UploadSessionProvider (consumes Transactions, Processing, ChartFilter)
export function AppStateProvider({ children }) {
    return (
        <AuthProvider>
            <BillingProvider>
                <UserPreferencesProvider>
                    <ProcessingProvider>
                        <TransactionsProvider>
                            <ChartFilterProvider>
                                <UploadSessionProvider>
                                    {children}
                                </UploadSessionProvider>
                            </ChartFilterProvider>
                        </TransactionsProvider>
                    </ProcessingProvider>
                </UserPreferencesProvider>
            </BillingProvider>
        </AuthProvider>
    );
}
