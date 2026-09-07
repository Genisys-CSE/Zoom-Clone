import MeetingRoomClient from "@/components/MeetingRoom/MeetingRoomClient";

export default async function MeetingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ name?: string; mic?: string; cam?: string; pid?: string }>;
}) {
  const { id } = await params;
  const { name = "John Doe", mic, cam, pid = "" } = await searchParams;
  return (
    <MeetingRoomClient
      meetingId={id}
      name={name}
      micOff={mic === "off"}
      camOff={cam === "off"}
      pid={pid}
    />
  );
}
