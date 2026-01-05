import { Job } from 'bullmq';
import { notificationService } from '../services/notification.service.js';
import { dailySummaryJob } from './daily-summary.job.js';

export async function notificationJob(job: Job) {
  const jobName = job.name;
  
  try {
    if (jobName === 'check-due-notifications') {
      console.log('🔔 Checking due loan notifications...');
      
      await notificationService.checkLoanDueNotifications();
      
      console.log('✅ Due notifications check completed');
      
      return { status: 'due_notifications_checked' };
    }
    
    if (jobName === 'daily-summary') {
      console.log('📊 Running daily summary...');
      
      const summary = await dailySummaryJob(job);
      
      console.log('✅ Daily summary completed');
      
      return { status: 'daily_summary_sent', summary };
    }
    
    // Handle individual notification sending
    if (jobName === 'send-notification') {
      const { userId, type, title, message, loanId, data } = job.data;
      
      await notificationService.createNotification({
        userId,
        type,
        title,
        message,
        loanId,
        data,
      });
      
      return { status: 'notification_sent' };
    }
    
  } catch (error) {
    console.error(`❌ Notification job (${jobName}) failed:`, error);
    throw error;
  }
}