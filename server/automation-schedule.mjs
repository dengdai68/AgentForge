import { CronExpressionParser } from 'cron-parser';

export function previewSchedule(cron, timeZone, after = new Date(), count = 5) {
  if (typeof cron !== 'string' || cron.length > 120 || cron.trim().split(/\s+/).length !== 5 || !/^[\d*,/\-\s]+$/.test(cron)) throw new Error('Cron 必须是五段：分 时 日 月 周，仅支持数字和 * , - /');
  if (typeof timeZone !== 'string' || !timeZone || timeZone.length > 80) throw new Error('请选择有效时区');
  try { new Intl.DateTimeFormat('en', { timeZone }); } catch { throw new Error('时区无效，请使用 IANA 时区名称'); }
  try {
    const expression = CronExpressionParser.parse(cron.trim(), { tz: timeZone, currentDate: after });
    return expression.take(count).map(date => date.toDate().toISOString());
  } catch { throw new Error('Cron 无效或无法计算下次执行时间'); }
}
