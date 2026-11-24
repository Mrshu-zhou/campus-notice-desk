import { createHash } from "node:crypto";
import sampleNotices from "../data/sample-notices.json" with { type: "json" };
import { handleExtractionRequest, type ExtractionImage, type ExtractionInput } from "../functions/handler.ts";

const [studentSample, counselorSample] = sampleNotices.pasteSamples;
const classSample = sampleNotices.notices.find((notice) => notice.id === "stu-wechat-class-forward");

// sha256 of public/demo/lab-safety-notice.png; keep in sync if the demo image changes.
const DEMO_IMAGE_SHA256 = "0b8671c60233530ea729dbb0f68f492ca8838c372b17ddfa0eb60c183a06be6b";

const DEMO_IMAGE_READ =
  "软件工程2301班（群聊 46）\n"
  + "陈雪：明天高数小测吗？第三题我还不会\n"
  + "阿凯：先吃饭，七点老地方\n"
  + "班长-周琪（转发通知）：@所有人 教务处的实验室安全准入通知：2026年11月27日（周五）17:00前，请各班学习委员收齐《实验室安全准入承诺书》，每人一份，必须本人签名，交到信息楼A312。\n"
  + "电子版要求：命名「班级+姓名+学号」，发到邮箱 labsafe@campus.edu.cn。\n"
  + "学习委员-杨柳：补充：承诺书是每个人都要签，不是只交一份。群里只发过空表，没填的同学自己在群文件下载，别交空白表。文件叫「2026实验室安全承诺书.pdf」。\n"
  + "陈雪：[群文件] 2026实验室安全承诺书.pdf（2.4 MB · 群文件）\n"
  + "阿凯：收到\n"
  + "王敏：今晚操场还去吗，篮球场人少\n"
  + "班长-周琪（提醒）：另外11月26日（周四）晚7点在宿舍楼下集合，参加消防演练，不用带东西。\n"
  + "我：收到，我今晚回去填好再打印\n"
  + "以上为虚构演示内容";

const DEMO_IGNORED = [
  { text: "明天高数小测吗？第三题我还不会", reason: "chat" as const },
  { text: "先吃饭，七点老地方", reason: "chat" as const },
  { text: "收到", reason: "acknowledgement" as const },
  { text: "今晚操场还去吗，篮球场人少", reason: "chat" as const },
  { text: "收到，我今晚回去填好再打印", reason: "acknowledgement" as const },
];

function nextDay(isoDate: string) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function nextWeekDay(isoDate: string, targetWeekday: number) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const weekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (8 - weekday) + (targetWeekday - 1));
  return date.toISOString().slice(0, 10);
}

const fixtures = new Map<string, (today: string) => unknown[]>([
  [
    studentSample.body,
    (today) => [
      {
        id: "local-student-cet4-registration",
        title: "英语四级报名",
        action: "在教务处网站「考试报名」完成英语四级报名，上传一寸白底证件照，文件名用学号。",
        deadline: nextDay(today),
        deadlineText: "今晚12点",
        materials: ["一寸白底证件照", "文件名用学号"],
        category: "action",
        sourceQuote: "老师刚在群里说：英语四级报名今晚12点截止，系统在教务处网站「考试报名」。要上传一寸白底证件照，文件名用学号。",
      },
    ],
  ],
  [
    counselorSample.body,
    () => [
      {
        id: "local-counselor-winter-run-roster",
        title: "报送冬季长跑学生名单",
        action: "将本班参加冬季长跑的学生名单 Excel 发至本邮箱，并注明免跑申请情况。",
        deadline: "2026-11-30",
        deadlineText: "11月30日17:00前",
        materials: ["学生名单 Excel", "免跑申请说明"],
        category: "action",
        sourceQuote: "请于11月30日17:00前报送本班参加冬季长跑的学生名单（Excel），发本邮箱，并注明是否有免跑申请。",
      },
    ],
  ],
]);

if (classSample) {
  fixtures.set(classSample.body, (today) => [
    {
      id: "local-class-tonghua-form",
      title: "交普通话报名表",
      action: "打印并签名「普通话报名表2026秋」（群文件置顶），携带学生证复印件交到教务办二教105。",
      deadline: null,
      deadlineText: "这周五还是下周五",
      materials: ["普通话报名表2026秋（群文件置顶）", "签名", "学生证复印件"],
      category: "needs_confirm",
      sourceQuote: "对了普通话那个表我也不确定是这周五还是下周五，辅导员原话是「尽快，最好这周」",
    },
    {
      id: "local-class-welcome-volunteer",
      title: "报名迎新志愿者（自愿）",
      action: "下周三下午若没课、愿意参加迎新志愿者，把名字发给班委；非强制。",
      deadline: nextWeekDay(today, 3),
      deadlineText: "下周三下午",
      materials: [],
      category: "action",
      sourceQuote: "下周三下午没课的来帮一下迎新志愿者，自愿的，想去的把名字发给我",
    },
    {
      id: "local-class-dorm-check",
      title: "准备宿舍卫生抽查",
      action: "下周一起不要把脏衣服堆在宿舍门口，做好卫生。",
      deadline: nextWeekDay(today, 1),
      deadlineText: "下周一开始查宿舍卫生",
      materials: [],
      category: "action",
      sourceQuote: "学院说下周一开始查宿舍卫生，晚上别把脏衣服堆门口就行",
    },
  ]);
}

function base64Bytes(data: string) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function isDemoScreenshot(image: ExtractionImage) {
  if (image.mediaType !== "image/png") return false;
  return createHash("sha256").update(base64Bytes(image.data)).digest("hex") === DEMO_IMAGE_SHA256;
}

function demoFixture(input: ExtractionInput, demoImages: ExtractionImage[]) {
  const sourceImageId = demoImages[0].id;
  return {
    tasks: [
      {
        id: "local-demo-lab-safety",
        title: "交实验室安全准入承诺书",
        action:
          "收齐本班《实验室安全准入承诺书》，每人一份、本人签名，于2026年11月27日（周五）17:00前交到信息楼A312；"
          + "电子版按「班级+姓名+学号」命名发到 labsafe@campus.edu.cn，空白表从群文件「2026实验室安全承诺书.pdf」下载。",
        deadline: "2026-11-27",
        deadlineText: "11月27日（周五）17:00前",
        materials: ["2026实验室安全承诺书.pdf（群文件空表）", "本人签名的《实验室安全准入承诺书》"],
        requirements: "电子版命名「班级+姓名+学号」发到 labsafe@campus.edu.cn；每人一份，不能只交一份。",
        category: "action",
        sourceImageId,
        sourceQuote: "2026年11月27日（周五）17:00前，请各班学习委员收齐《实验室安全准入承诺书》，每人一份，必须本人签名，交到信息楼A312。",
      },
      {
        id: "local-demo-fire-drill",
        title: "参加消防演练",
        action: "11月26日（周四）晚7点到宿舍楼下集合参加消防演练，不用带东西。",
        deadline: "2026-11-26",
        deadlineText: "11月26日（周四）晚7点",
        materials: [],
        category: "action",
        location: "宿舍楼下",
        sourceImageId,
        sourceQuote: "另外11月26日（周四）晚7点在宿舍楼下集合，参加消防演练，不用带东西。",
      },
    ],
    imageReads: demoImages.map((image) => ({
      imageId: image.id,
      text: DEMO_IMAGE_READ,
      uncertain: false,
      notes: "虚构演示截图；文字清晰，已按图中可见内容核对转写。",
    })),
    ignored: DEMO_IGNORED,
    today: input.today,
  };
}

const LOCAL_ONLY_MESSAGE =
  "本地预览只对已核对样例走 local_fixture：内置演示截图和三段已核对文字可以进入确认页；"
  + "任意截图或文字不会在本地假装在线拆解成功。公开站点才走 Cloud Agent。";

export function localFixtureHandler(request: Request): Promise<Response> {
  return handleExtractionRequest(request, (input) => {
    const images = input.images;
    const demoImages = images.filter(isDemoScreenshot);
    const hasUnknownImage = demoImages.length !== images.length;

    if (images.length === 0) {
      const tasks = fixtures.get(input.body)?.(input.today);
      if (tasks) {
        return Response.json(
          { ok: true, mode: "local_fixture", tasks, imageReads: [], ignored: [] },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
    } else if (demoImages.length > 0 && !hasUnknownImage && input.body.trim() === "") {
      const fixture = demoFixture(input, demoImages);
      return Response.json(
        { ok: true, mode: "local_fixture", tasks: fixture.tasks, imageReads: fixture.imageReads, ignored: fixture.ignored },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return Response.json(
      {
        ok: false,
        error: "cloud_agent_not_enabled",
        message: LOCAL_ONLY_MESSAGE,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  });
}