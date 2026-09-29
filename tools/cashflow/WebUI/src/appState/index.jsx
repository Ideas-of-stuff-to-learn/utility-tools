import { AuthProvider } from './AuthContext';
import { ProcessingProvider } from './ProcessingContext';
import { TransactionsProvider } from './TransactionsContext';
import { ChartFilterProvider } from './ChartFilterContext';
import { UserPreferencesProvider } from './UserPreferencesContext';
import { UploadSessionProvider } from './UploadSessionContext';

export { useAuth } from './AuthContext';
export { useProcessing } from './ProcessingContext';
export { useTransactions } from './TransactionsContext';
export { useChartFilter } from './ChartFilterContext';
export { useUserPreferences } from './UserPreferencesContext';
export { useUploadSession } from './UploadSessionContext';

// Nesting order matters: inner providers may consume outer ones.
//   AuthProvider (no deps)
//     UserPreferencesProvider (consumes Auth for server hydration)
//       ProcessingProvider (no deps)
//         TransactionsProvider (consumes Auth, Processing, UserPreferences)
//           ChartFilterProvider (consumes Transactions)
//             UploadSessionProvider (consumes Transactions, Processing, ChartFilter)
export function AppStateProvider({ children }) {
    return (
        <AuthProvider>
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
        </AuthProvider>
    );
}
