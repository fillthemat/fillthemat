import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ScheduleWindowItem } from "./schedule-section";
import { DAY_NAMES, formatCount, formatMinutes, formatTimeRange, WEEK_ORDER } from "../format";

export function WeeklyCalendar({
  windows,
  onAdd,
  onSelect,
}: {
  windows: ScheduleWindowItem[];
  onAdd: (button: HTMLButtonElement, day: number) => void;
  onSelect: (button: HTMLButtonElement, id: string) => void;
}) {
  const [selectedDay, setSelectedDay] = useState<number>(1);
  const times = [...new Set(windows.map((item) => item.startMinute))].sort((a, b) => a - b);
  const dayItems = windows
    .filter((item) => item.dayOfWeek === selectedDay)
    .sort((a, b) => a.startMinute - b.startMinute);

  const addButton = (day: number) => (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      aria-label={`Add class on ${DAY_NAMES[day]}`}
      onClick={(event) => onAdd(event.currentTarget, day)}
    >
      + Add
    </Button>
  );

  const card = (item: ScheduleWindowItem) => (
    <button
      key={item.id}
      type="button"
      onClick={(event) => onSelect(event.currentTarget, item.id)}
      className="flex w-full flex-col gap-1 rounded-md border border-l-4 border-border border-l-primary bg-card p-2 text-left break-words hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="text-sm font-semibold">{item.offeringName}</span>
      <span className="text-xs tabular-nums">
        {formatTimeRange(item.startMinute, item.durationMinutes)}
      </span>
      <span className="text-xs text-muted-foreground">
        {!item.active
          ? "Turned off"
          : !item.offeringActive
            ? "Not offered"
            : formatCount(item.capacity, "spot")}
      </span>
      {item.hasUpcomingBooking && (
        <span className="text-xs text-muted-foreground">Upcoming bookings</span>
      )}
    </button>
  );

  return (
    <div className="@container">
      <div className="hidden overflow-hidden rounded-lg border border-border @min-[44rem]:block">
        <Table aria-label="Recurring weekly timetable" variant="timetable">
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="w-16">
                Start
              </TableHead>
              {WEEK_ORDER.map((day) => (
                <TableHead key={day} scope="col">
                  <div className="font-semibold text-foreground">
                    <abbr title={DAY_NAMES[day]} className="no-underline">
                      {DAY_NAMES[day].slice(0, 3)}
                    </abbr>
                  </div>
                  {addButton(day)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {times.length === 0 && (
              <TableRow>
                <TableCell colSpan={8}>
                  <p className="py-8 text-center text-muted-foreground">
                    Choose a day above to add your first class time.
                  </p>
                </TableCell>
              </TableRow>
            )}
            {times.map((minute) => (
              <TableRow key={minute}>
                <TableHead scope="row">{formatMinutes(minute)}</TableHead>
                {WEEK_ORDER.map((day) => (
                  <TableCell key={day}>
                    <div className="flex flex-col gap-1">
                      {windows
                        .filter((item) => item.dayOfWeek === day && item.startMinute === minute)
                        .map(card)}
                    </div>
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-col gap-3 @min-[44rem]:hidden">
        <div role="group" aria-label="Choose weekday" className="grid grid-cols-7 gap-1">
          {WEEK_ORDER.map((day) => (
            <Button
              key={day}
              type="button"
              size="sm"
              variant={day === selectedDay ? "secondary" : "ghost"}
              aria-label={DAY_NAMES[day]}
              aria-pressed={day === selectedDay}
              onClick={() => setSelectedDay(day)}
            >
              {DAY_NAMES[day].slice(0, 3)}
            </Button>
          ))}
        </div>
        <section
          aria-label={DAY_NAMES[selectedDay]}
          className="rounded-lg border border-border p-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{DAY_NAMES[selectedDay]}</h3>
            {addButton(selectedDay)}
          </div>
          <div className="mt-2 flex flex-col gap-2">
            {dayItems.length ? (
              dayItems.map(card)
            ) : (
              <p className="text-sm text-muted-foreground">
                No class times on {DAY_NAMES[selectedDay]}.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
