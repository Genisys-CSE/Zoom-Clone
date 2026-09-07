export interface UpcomingMeeting {
  id: string; // backend row id
  meetingId: string; // digits, e.g. "1112223330"
  title: string;
  day: string; // "12"
  month: string; // "SEP"
  dateKey: string; // "2026-09-08" for day filtering
  time: string; // "Today, 2:00 PM - 2:30 PM"
}

export interface RecentMeeting {
  id: string; // display id "123-456-789"
  meetingId: string; // digits for DELETE
  title: string;
  date: string; // "Sep 6, 2026"
  duration: string; // "42 min"
}
