CAMPUSMEET

ĐẶC TẢ YÊU CẦU PHẦN MỀM VÀ PHÂN TÍCH DỰ ÁN

Hệ thống quản lý cuộc họp và công việc nhóm tích hợp Google Meet trên nền tảng AWS Serverless

> **Ghi chú:** Nguyên tắc cốt lõi: CampusMeet không xây dựng hoặc sao chép Google Meet. Hệ thống quản lý quy trình trước - trong - sau cuộc họp; Google Calendar API tạo lịch/liên kết và Google Meet REST API chỉ đồng bộ artifact hậu họp khi thực tế khả dụng.

Tên tiếng Anh: CampusMeet - Meeting and Team Work Management System with Google Meet Integration

> **Trạng thái baseline ngày 27/07/2026:** Đã chốt hướng Google Calendar + Google Meet REST API có fallback; CampusMeet vẫn là web app độc lập trên AWS và có thể bổ sung Google Meet Add-on side panel để dùng trong cùng tab, không nhúng giao diện Meet vào CampusMeet. Đã chốt các nguyên tắc AI về consent/capture, diarization ẩn danh, STT provider có thể thay thế, grounded output, human-in-the-loop và RAG cách ly theo nhóm. AI MVP là luồng dọc bắt buộc; các năng lực live/agentic/RAG mở rộng triển khai theo pha.

# Cách sử dụng tài liệu

- Mục 1 đến Mục 5 giúp cả nhóm thống nhất bài toán, người dùng, phạm vi và các giới hạn triển khai trước khi lập trình.

- Mục 6 đến Mục 9 mô tả các chức năng, ca sử dụng, nhu cầu người dùng, quy tắc nghiệp vụ và dữ liệu.

- Mục 10 đến Mục 13 dùng để thiết kế, triển khai, kiểm thử, giám sát và dọn dẹp tài nguyên AWS.

- Mục 14 đến Mục 16 hỗ trợ phân công, theo dõi tiến độ, quản lý rủi ro và hoàn thiện workshop.

> **Ghi chú:** Quy tắc thay đổi phạm vi: CampusMeet giữ một luồng AI dọc có kiểm soát gồm tài liệu/audio → transcript → biên bản/action item → hỏi đáp có trích dẫn. Video call riêng, chat thời gian thực giữa người dùng, phân tích video dài, live transcription và agent tự ghi dữ liệu không qua xác nhận không được làm trước khi luồng lõi cùng AI MVP đã được kiểm thử đầu-cuối. Mọi thay đổi phải được nhóm ghi nhận về ảnh hưởng tới dữ liệu, API, chi phí, kiểm thử và tiến độ.

# Mục lục

- 1. Giới thiệu và bối cảnh dự án

- 2. Tầm nhìn, mục tiêu và tiêu chí thành công

- 3. Phân tích nghiệp vụ: hiện trạng và quy trình mục tiêu

- 4. Người dùng và quyền sử dụng

- 5. Phạm vi, giả định, ràng buộc và ưu tiên

- 6. Yêu cầu chức năng và yêu cầu tích hợp

- 7. Mô tả các ca sử dụng chính

- 8. Nhu cầu người dùng và giá trị sử dụng

- 9. Quy tắc nghiệp vụ, trạng thái và dữ liệu

- 10. Kiến trúc giải pháp AWS và lý do lựa chọn

- 11. API, bảo mật, quyền riêng tư và xử lý lỗi

- 12. Yêu cầu phi chức năng

- 13. Kiểm thử, giám sát và dọn dẹp tài nguyên

- 14. Kế hoạch thực hiện và phân công nhóm

- 15. Rủi ro và điều kiện hoàn thành MVP

- 16. Phụ lục

# 1. Giới thiệu và bối cảnh dự án

## 1.1 Mục đích

CampusMeet là hệ thống quản lý cuộc họp và công việc nhóm dành cho nhóm học tập, nhóm đồ án hoặc nhóm dự án nhỏ. Hệ thống tập trung các hoạt động trước - trong - sau cuộc họp: tạo nhóm, lập lịch, quản lý nội dung họp (agenda) và người tham dự, tạo sự kiện Google Calendar kèm liên kết Google Meet, nhắc lịch, ghi biên bản, chuyển việc cần thực hiện thành công việc có người phụ trách và theo dõi tiến độ qua bảng tổng quan.

## 1.2 Vấn đề cần giải quyết

| Vấn đề | Hệ quả | CampusMeet xử lý như thế nào |
| --- | --- | --- |
| Thông tin bị phân tán | Lịch nằm ở Calendar, nhắc lịch ở chat, biên bản ở tài liệu riêng, công việc ở nhiều nơi. | Tạo một không gian nhóm thống nhất, liên kết cuộc họp, biên bản, quyết định và công việc. |
| Thiếu quy trình sau họp | Quyết định không gắn người phụ trách hoặc hạn hoàn thành; công việc dễ bị quên. | Việc cần thực hiện trong biên bản có thể chuyển thành công việc có người phụ trách, hạn hoàn thành và trạng thái. |
| Khó điều phối nhóm | Người quản lý không thấy cuộc họp sắp tới, việc quá hạn hay mức độ hoàn thành. | Bảng tổng quan cá nhân và nhóm hiển thị các chỉ số cần theo dõi. |
| Tạo liên kết Meet thủ công | Người điều phối phải tự tạo sự kiện Google Calendar và gửi liên kết qua nhiều kênh. | Người tổ chức kết nối Google để CampusMeet tạo sự kiện và yêu cầu tạo liên kết hội nghị. |
| Khó theo dõi tài liệu dài | Thành viên không có thời gian đọc toàn bộ tài liệu dài hoặc có thắc mắc trong lúc họp. | Hỗ trợ tải tài liệu và Trợ lý AI trong CampusMeet web; khi cần trải nghiệm cùng tab, dùng CampusMeet Meet Add-on ở side panel của Google Meet. Document PiP chỉ là fallback/progressive enhancement. |
| Thiếu bằng chứng vận hành | Đồ án chỉ có giao diện CRUD nên khó thể hiện triển khai cloud đầu-cuối. | Triển khai serverless, có log, chỉ số, cảnh báo, hướng dẫn triển khai và dọn dẹp tài nguyên. |

## 1.3 Cơ sở kỹ thuật

Google Calendar API cho phép yêu cầu tạo dữ liệu hội nghị khi tạo sự kiện, với `conferenceData.createRequest`, `requestId` riêng cho từng sự kiện và `conferenceDataVersion = 1`. Việc tạo liên kết có thể hoàn tất bất đồng bộ, vì vậy CampusMeet cần hiển thị trạng thái rõ ràng thay vì giả định liên kết luôn có ngay. [TL1][TL2]

EventBridge Scheduler phù hợp cho các thông báo nhắc lịch theo thời điểm cụ thể. Với phần giao diện tĩnh, mô hình S3 private REST origin kết hợp CloudFront và Origin Access Control (OAC) giúp phân phối nội dung an toàn hơn so với public S3 website bucket. [TL3][TL4]

Google Meet REST API có thể cung cấp conference records, participant sessions, recordings và transcripts sau cuộc họp khi artifact thực sự tồn tại và tài khoản đã cấp đúng quyền. CampusMeet ưu tiên đồng bộ các artifact này khi khả dụng; nếu gói tài khoản, cài đặt quản trị, quyền OAuth hoặc ngôn ngữ không đáp ứng thì hệ thống chuyển sang upload thủ công hoặc ghi âm có sự đồng ý. Trong MVP, việc kiểm tra artifact dùng thao tác đồng bộ thủ công hoặc polling có giới hạn từ AWS; không phụ thuộc Google Workspace Events vì dịch vụ này yêu cầu Google Cloud Pub/Sub làm notification endpoint. [TL9][TL10][TL12][TL20][TL21]

Google Meet Add-ons SDK cho phép đưa giao diện CampusMeet vào side panel hoặc main stage của Meet. CampusMeet không chuyển toàn bộ sản phẩm thành add-on: web app đầy đủ và backend vẫn được host trên AWS; Google Meet chỉ tải một route HTTPS tối giản của CampusMeet trong iframe add-on. Bản demo có thể cài deployment chưa công bố; bản private chỉ dành cho cùng Google Workspace organization, còn bản public phải qua Google Marketplace/OAuth review. [TL22][TL23][TL24][TL25]

Phần AI dùng dịch vụ managed: S3 cho nội dung, Amazon Transcribe hoặc adapter STT đã benchmark cho tiếng Việt, Amazon Bedrock cho hỏi đáp/tool use và Bedrock Knowledge Bases kết hợp S3 Vectors cho truy xuất nhiều cuộc họp. Mọi nội dung sinh tự động là bản nháp có trích dẫn; mọi thao tác ghi do AI đề xuất phải đi qua kiểm tra quyền và xác nhận của người dùng. [TL13][TL14][TL15][TL16][TL17]

# 2. Mục tiêu và tiêu chí thành công

## 2.1 Mục tiêu
CampusMeet hướng tới việc trở thành một không gian làm việc nhẹ cho nhóm học tập hoặc nhóm dự án nhỏ: một cuộc họp không dừng lại ở việc tạo liên kết Meet mà tạo thành một chu trình có kế hoạch, nhắc lịch, biên bản, công việc và theo dõi tiến độ. Hệ thống không cạnh tranh với Google Meet; hệ thống bổ sung phần quản lý quy trình xung quanh cuộc họp.


| Mục tiêu | Kết quả mong muốn |
| --- | --- |
| Quản lý tập trung | Tạo nhóm, quản lý thành viên, lịch họp, biên bản và công việc trong cùng một hệ thống. |
| Tích hợp minh bạch | Tạo Google Calendar event và liên kết Google Meet khi tài khoản Google của người tổ chức đã được kết nối. |
| Theo dõi sau họp | Chuyển việc cần thực hiện thành công việc có người phụ trách, hạn hoàn thành và trạng thái. |
| Thể hiện dự án AWS hoàn chỉnh | Có kiến trúc serverless, triển khai, log, chỉ số, cảnh báo, kiểm thử và dọn dẹp tài nguyên. |
| Kiểm soát phạm vi và chi phí | Ưu tiên dịch vụ managed/serverless; không sử dụng EC2, NAT Gateway, RDS hoặc hạ tầng gọi video riêng trong MVP. |

## 2.2 Tiêu chí thành công của MVP

- Quản trị viên tạo được nhóm, thêm thành viên và lập lịch cuộc họp.

- Cuộc họp được lưu nội bộ; khi Google đã kết nối, hệ thống hiển thị đúng trạng thái đồng bộ và liên kết Meet khi sẵn sàng.

- Thông báo nhắc lịch được tạo đúng thời điểm; thông báo trong hệ thống không phụ thuộc vào việc gửi email có thành công hay không.

- Biên bản sau họp có thể tạo công việc, giao người phụ trách và cập nhật lên bảng tổng quan.

- Nhóm trình bày được log CloudWatch, ít nhất một cảnh báo thử nghiệm, tài liệu triển khai và checklist dọn dẹp.

- AI MVP xử lý được ít nhất một tài liệu hoặc audio tiếng Việt thành dữ liệu có thể tra cứu; tạo bản nháp biên bản/action item và trả lời câu hỏi trong phạm vi một cuộc họp kèm nguồn tham chiếu, nhưng không tự ghi thay đổi nghiệp vụ khi chưa được người dùng xác nhận.

# 3. Phân tích nghiệp vụ: hiện trạng và quy trình mục tiêu

## 3.1 Quy trình hiện trạng

1. Người điều phối tạo Google Meet link hoặc Google Calendar event thủ công.

2. Nội dung họp và thông báo nhắc lịch thường được gửi qua ứng dụng chat; thành viên mới có thể không nhìn thấy lịch sử.

3. Sau cuộc họp, ghi chú hoặc biên bản thường nằm trong file/tài liệu riêng.

4. Việc cần thực hiện được nhắn rời rạc hoặc không gắn người phụ trách và hạn hoàn thành.

5. Không có bảng tổng quan chung để nhìn cuộc họp kế tiếp, công việc sắp đến hạn và công việc quá hạn.

## 3.2 Quy trình mục tiêu

| Giai đoạn | Chủ thể | Hoạt động | Kết quả |
| --- | --- | --- | --- |
| Trước họp | Quản trị viên nhóm / người tổ chức | Tạo cuộc họp, nội dung họp, người tham dự và nhắc lịch; xác nhận kết nối Google. | Cuộc họp nội bộ, sự kiện Google Calendar và trạng thái liên kết Meet. |
| Chuẩn bị | Hệ thống | Tạo lịch nhắc; kiểm tra hoặc thử lại khi việc tạo liên kết còn chờ. | Thông báo được lập lịch và trạng thái đồng bộ có thể quan sát. |
| Trong họp | Thành viên | Mở đúng liên kết Google Meet và tham chiếu nội dung họp trong CampusMeet. | Cuộc họp diễn ra trên Google Meet. |
| Sau họp | Quản trị viên / người ghi biên bản | Ghi biên bản, quyết định, việc cần thực hiện; tạo công việc cho thành viên. | Biên bản và công việc liên kết với cuộc họp. |
| Theo dõi | Thành viên / quản trị viên | Cập nhật trạng thái công việc và xem bảng tổng quan. | Tiến độ, công việc quá hạn, tỷ lệ hoàn thành và lịch sắp tới. |

## 3.3 Quy trình nghiệp vụ chính

1. Thành viên tạo hoặc tham gia nhóm.

2. Quản trị viên lập lịch cuộc họp, chọn thành viên tham dự và thời điểm nhắc lịch.

3. Người tổ chức cấp quyền Google Calendar cho CampusMeet.

4. CampusMeet lưu cuộc họp nội bộ và yêu cầu Google Calendar tạo sự kiện cùng dữ liệu hội nghị.

5. Hệ thống cập nhật trạng thái `PENDING`, `READY` hoặc `FAILED`; chỉ hiển thị liên kết Meet khi trạng thái là `READY`.

6. Hệ thống tạo lịch nhắc; đến thời điểm đã chọn, thông báo được gửi trong ứng dụng và email chỉ là kênh bổ sung.

7. Sau họp, người ghi biên bản lưu kết quả thảo luận, quyết định và việc cần thực hiện.

8. Việc cần thực hiện được chuyển thành công việc có người phụ trách, hạn hoàn thành và trạng thái.

9. Bảng tổng quan hiển thị cuộc họp sắp tới, công việc cần chú ý và tiến độ của nhóm.

# 4. Người dùng và quyền sử dụng

CampusMeet chỉ có hai vai trò nghiệp vụ chính: Thành viên và Quản trị viên nhóm. Một người có thể là quản trị viên của nhóm này nhưng chỉ là thành viên ở nhóm khác. Người tổ chức cuộc họp không phải một vai trò toàn cục; đó là quản trị viên được chọn để dùng tài khoản Google của họ tạo sự kiện cho một cuộc họp cụ thể.

| Chức năng | Thành viên | Quản trị viên nhóm |
| --- | --- | --- |
| Xem nhóm, lịch họp và công việc của nhóm mình | Có | Có |
| Tạo nhóm | Có | Có |
| Chấp nhận lời mời tham gia nhóm | Có | Có |
| Mời hoặc xóa thành viên | Không | Có |
| Tạo, sửa hoặc hủy cuộc họp | Không | Có |
| Kết nối Google Calendar và tạo liên kết Meet | Không | Có, khi được chọn làm người tổ chức |
| Viết hoặc cập nhật biên bản | Theo quyền do nhóm thiết lập | Có |
| Tạo và giao công việc | Không | Có |
| Cập nhật trạng thái công việc được giao | Có | Có |
| Xem bảng tổng quan cá nhân | Có | Có |
| Xem bảng tổng quan toàn nhóm | Không | Có |

> **Ghi chú:** Nguyên tắc phân quyền: người dùng chỉ được xem hoặc thay đổi dữ liệu của những nhóm mà họ là thành viên. Cognito dùng để xác thực danh tính; Lambda vẫn phải kiểm tra thành viên và quyền theo `groupId` trước khi đọc hoặc ghi dữ liệu.

# 5. Phạm vi, giả định, ràng buộc và ưu tiên

## 5.1 Phạm vi theo MoSCoW

| Mức ưu tiên | Hạng mục | Quyết định |
| --- | --- | --- |
| Bắt buộc | Xác thực, nhóm/thành viên, quản lý cuộc họp, trạng thái tích hợp Calendar/Meet, nhắc lịch, biên bản, công việc, bảng tổng quan, log/cảnh báo/dọn dẹp. | Phải có để gọi là MVP. |
| Bắt buộc cho AI MVP | Upload an toàn vào S3; batch transcription tiếng Việt; timestamp/confidence/speaker label; chỉnh sửa transcript; hỏi đáp một cuộc họp có trích dẫn; sinh bản nháp biên bản/action item; xác nhận trước khi ghi dữ liệu. | Là luồng AI dọc dùng để demo giá trị sản phẩm; phải có fallback thủ công khi STT/Bedrock lỗi. |
| Nên có | Lời mời qua email/liên kết, đồng bộ khi sửa/hủy lịch, nhật ký thao tác, lịch theo tháng/tuần, demo email bằng SES; agenda do AI đề xuất; form cuộc họp do AI điền sẵn; CampusMeet Meet Add-on side panel dùng cùng backend/API; Document PiP làm fallback; đồng bộ artifact Google Meet khi khả dụng. | Thực hiện khi các luồng bắt buộc đã ổn định; add-on được thử bằng deployment chưa công bố trước khi cân nhắc private/public Marketplace. |
| Có thể có | RAG trên nhiều cuộc họp, agentic tools theo allowlist, live transcription, lịch định kỳ, tích hợp Discord/Slack, đọc hình ảnh/tài liệu nâng cao. | Thuộc pha AI mở rộng; vẫn phải dùng phân quyền, trích dẫn và human-in-the-loop. |
| Không làm trong MVP | Video/audio call riêng, chat thời gian thực giữa các user, WebRTC/TURN, tự ghi âm khi chưa có thao tác đồng ý, tự đoán danh tính speaker, AI đọc video dài, đánh giá cá nhân từ dữ liệu Meet, hoặc để AI ghi dữ liệu mà không xác nhận. | Loại khỏi baseline 8 tuần; có thể nghiên cứu sau khi đánh giá bảo mật, chi phí và quyền riêng tư. |

## 5.2 Giả định

- Mỗi cuộc họp có một người tổ chức là người cấp quyền OAuth để sự kiện được tạo trong Google Calendar của họ.

- Chính sách tài khoản Google/Google Workspace có thể ảnh hưởng tới khả năng tạo hoặc hiển thị dữ liệu hội nghị; hệ thống phải hiển thị trạng thái thay vì cam kết liên kết luôn trả về ngay.

- Standard use của Google Meet REST API không phát sinh phí API bổ sung trong quota tại thời điểm chốt tài liệu; recording/transcript chỉ có khi gói tài khoản, cài đặt và quyền thực tế cho phép. Google Meet transcript tích hợp chưa hỗ trợ tiếng Việt, vì vậy AI MVP vẫn cần adapter STT riêng. Chính sách giá và quota phải được kiểm tra lại trước mỗi lần demo/deploy. [TL11][TL12][TL21]

- MVP được minh họa với dữ liệu nhỏ: khoảng 3 đến 5 nhóm, 10 đến 30 thành viên và 20 đến 50 cuộc họp.

- Múi giờ mặc định là Asia/Ho_Chi_Minh; dữ liệu thời gian được lưu theo UTC và quy đổi khi hiển thị.

- Nhóm dùng GitHub, nhánh làm việc, pull request và một công cụ Infrastructure as Code thống nhất: AWS CDK TypeScript hoặc AWS SAM.

## 5.3 Ràng buộc

| Ràng buộc | Hệ quả thiết kế |
| --- | --- |
| 08 tuần / 05 thành viên | Phải ưu tiên các luồng cốt lõi; chức năng nâng cao không được chặn MVP. |
| Mục tiêu serverless và kiểm soát chi phí | Không dùng EC2, NAT Gateway, RDS, ALB, EKS/Kubernetes trong MVP. |
| Tích hợp Google phụ thuộc bên thứ ba | Cần mô phỏng adapter, cơ chế thử lại, trải nghiệm lỗi rõ ràng và kiểm thử OAuth thất bại. |
| Artifact Google phụ thuộc gói và quyền | Không cam kết luôn có recording/transcript; phải có fallback upload/recording được đồng ý và nút đồng bộ lại. |
| Audio, tài liệu và AI có dữ liệu nhạy cảm | Phải có consent, mã hóa, giới hạn truy cập theo nhóm, retention/xóa, kiểm tra file và chống prompt injection. |
| AI/STT có độ chính xác và chi phí biến đổi | Benchmark tiếng Việt; đặt budget/quota; xử lý bất đồng bộ; luôn cho phép sửa thủ công và fallback không AI. |
| SES sandbox theo Region | Thông báo trong ứng dụng là bắt buộc; email là kênh bổ sung khi demo. |
| Workshop yêu cầu log, metric, alert và cleanup | Giám sát, IaC và kiểm soát chi phí là một phần của yêu cầu, không phải phần phụ. |

# 6. Yêu cầu chức năng và yêu cầu tích hợp

Các yêu cầu dưới đây là nền tảng triển khai. Các yêu cầu Bắt buộc phải được kiểm thử trước khi nhóm chuyển sang chức năng nâng cao. Mã FR dùng để nhóm dễ trao đổi, kiểm thử và đối chiếu trong quá trình phát triển.

| Mã | Ưu tiên | Nhóm chức năng | Yêu cầu |
| --- | --- | --- | --- |
| FR-01 | Bắt buộc | Xác thực | Cho phép đăng nhập/đăng xuất bằng Amazon Cognito User Pool; giao diện ứng dụng không tự quản lý mật khẩu thô. |
| FR-02 | Bắt buộc | Hồ sơ | Lưu tên hiển thị, email, múi giờ và tùy chọn nhận thông báo của người dùng. |
| FR-03 | Bắt buộc | Nhóm | Người dùng có thể tạo nhóm; người tạo mặc định trở thành Quản trị viên nhóm. |
| FR-04 | Bắt buộc | Thành viên | Quản trị viên nhóm có thể mời, xem và xóa thành viên; không được xóa Quản trị viên nhóm cuối cùng. |
| FR-05 | Bắt buộc | Cuộc họp | Quản trị viên nhóm có thể tạo cuộc họp nháp hoặc đã lên lịch với tiêu đề, thời gian, nội dung họp, người tổ chức và người tham dự. |
| FR-06 | Bắt buộc | Kiểm tra dữ liệu | Từ chối thời gian bắt đầu trong quá khứ và người tham dự không thuộc nhóm. |
| FR-07 | Bắt buộc | Kết nối Google | Người tổ chức có thể kết nối/ngắt kết nối tài khoản Google qua OAuth; token không hiển thị ở trình duyệt. |
| FR-08 | Bắt buộc | Tích hợp Calendar | Khi tạo cuộc họp có người tổ chức đã kết nối Google, hệ thống tạo Google Calendar event và gửi yêu cầu `conferenceData.createRequest` với `requestId` duy nhất. |
| FR-09 | Bắt buộc | Trạng thái đồng bộ | Lưu `googleEventId`, `googleSyncStatus` (`NOT_REQUESTED/PENDING/READY/FAILED_RETRYABLE/ACTION_REQUIRED`), số lần thử lại và thông báo lỗi an toàn. |
| FR-10 | Bắt buộc | Liên kết Meet | Chỉ hiển thị liên kết Google Meet cho thành viên của nhóm khi trạng thái đồng bộ là `READY`. |
| FR-11 | Bắt buộc | Cập nhật/hủy lịch | Sửa hoặc hủy cuộc họp phải cập nhật dữ liệu nội bộ; nếu đã đồng bộ Google event thì hệ thống thử đồng bộ thay đổi và lưu kết quả. |
| FR-12 | Bắt buộc | Nhắc lịch | Quản trị viên cấu hình tối đa 3 mốc nhắc; hệ thống tạo lịch EventBridge Scheduler hợp lệ cho từng mốc. |
| FR-13 | Bắt buộc | Thông báo | Reminder Lambda luôn tạo thông báo trong ứng dụng, kể cả khi gửi email thất bại. |
| FR-14 | Nên có | Email | Gửi email bằng SES khi người dùng chọn nhận email và danh tính/địa chỉ phù hợp trong môi trường demo. |
| FR-15 | Bắt buộc | Biên bản | Người có quyền ghi biên bản có thể tạo/cập nhật tóm tắt, nội dung thảo luận, quyết định và việc cần thực hiện. |
| FR-16 | Bắt buộc | Công việc | Quản trị viên tạo công việc với tiêu đề, người phụ trách, mức ưu tiên, trạng thái và hạn hoàn thành tùy chọn. |
| FR-17 | Bắt buộc | Tiến độ công việc | Người phụ trách cập nhật trạng thái `TODO/DOING/DONE`; hệ thống lưu thời điểm hoàn thành khi trạng thái là `DONE`. |
| FR-18 | Bắt buộc | Bảng tổng quan | Bảng tổng quan cá nhân hiển thị lịch sắp tới, việc sắp đến hạn, quá hạn và mức hoàn thành; bảng tổng quan nhóm hiển thị công việc theo trạng thái và theo người phụ trách. |
| FR-19 | Nên có | Nhật ký | Ghi lại các hành động tạo/sửa/hủy cuộc họp và thay đổi công việc quan trọng, gồm người thao tác, thời điểm và đối tượng. |
| FR-20 | Bắt buộc | Kiểm soát truy cập | Mọi API nghiệp vụ phải kiểm tra thành viên theo `groupId` trước khi trả hoặc thay đổi dữ liệu. |
| FR-21 | Bắt buộc | Trải nghiệm lỗi | Trả phản hồi lỗi chuẩn gồm mã, thông báo và `requestId`; không đưa stack trace hoặc token lên giao diện. |
| FR-22 | Bắt buộc | Giám sát | API Lambda và Reminder Lambda ghi log có cấu trúc cùng các metric cần thiết vào CloudWatch. |
| FR-23 | Bắt buộc | Cảnh báo | Có ít nhất một CloudWatch Alarm gửi thông báo SNS cho người phụ trách khi kiểm thử. |
| FR-24 | Bắt buộc | Dọn dẹp | Repository có lệnh IaC destroy hoặc checklist dọn dẹp, đồng thời xác nhận tài nguyên demo đã được kiểm tra/xóa. |
| FR-25 | Bắt buộc AI MVP | Tệp đính kèm | Thành viên được phép lấy S3 presigned URL để upload file thuộc allowlist; backend xác nhận MIME, kích thước, checksum và trạng thái kiểm tra an toàn trước khi đưa file vào AI. Upload được thực hiện ở trang cuộc họp hoặc trong khung Chatbot. |
| FR-26 | Bắt buộc AI MVP | Công việc AI bất đồng bộ | Mỗi yêu cầu parse tài liệu, transcription hoặc sinh nội dung tạo một `AIJob` có trạng thái `QUEUED/PROCESSING/COMPLETED/FAILED/CANCELLED`; API không chờ xử lý file/audio dài trong một request đồng bộ. |
| FR-27 | Bắt buộc AI MVP | Ghi âm có đồng ý | Chỉ bắt đầu capture sau thao tác rõ ràng của người dùng; giao diện luôn hiển thị đang ghi và nguồn capture. Hệ thống không cam kết thu được toàn bộ âm thanh Google Meet nếu người dùng chỉ cấp microphone. |
| FR-28 | Bắt buộc AI MVP | STT tiếng Việt | Audio được upload trực tiếp vào S3 và xử lý batch qua `SpeechToTextProvider`, ưu tiên Amazon Transcribe `vi-VN`; có thể thay bằng Deepgram sau benchmark. Kết quả gồm text, timestamp, confidence và speaker label ẩn danh. |
| FR-29 | Bắt buộc AI MVP | Hiệu chỉnh transcript | Người có quyền được nghe lại theo timestamp, sửa nội dung và ánh xạ `Speaker 0/1/...` sang thành viên. Hệ thống không tự đoán danh tính speaker và lưu lịch sử phiên bản chỉnh sửa. |
| FR-30 | Bắt buộc AI MVP | Hỏi đáp có căn cứ | Amazon Bedrock trả lời dựa trên tài liệu, transcript và biên bản mà người dùng được phép xem; câu trả lời phải có citation tới file, meeting hoặc transcript segment và phải nói rõ khi không đủ bằng chứng. |
| FR-31 | Bắt buộc AI MVP | Biên bản và action item | AI sinh bản nháp tóm tắt, quyết định và action item từ nguồn đã chọn. Người có quyền ghi biên bản phải duyệt/chỉnh sửa trước khi lưu hoặc chuyển action item thành task. |
| FR-32 | Nên có | Agenda thông minh | AI đề xuất agenda hoặc điền sẵn form cuộc họp từ mô tả ngắn; không tự tạo Calendar event khi chưa xác nhận. |
| FR-33 | Nên có | Agentic proposal | Bedrock tool use chỉ được chọn tool trong allowlist và tạo đề xuất có cấu trúc. Nội dung tài liệu/transcript được xem là dữ liệu không tin cậy và không được phép tự kích hoạt tool. |
| FR-34 | Nên có | Xác nhận hành động AI | Backend kiểm tra schema, membership/role, idempotency và chính sách nghiệp vụ; frontend hiển thị preview; chỉ sau khi người dùng xác nhận mới gọi API nghiệp vụ chuẩn và ghi audit log. |
| FR-35 | Có thể có | RAG nhiều cuộc họp | Truy xuất tri thức theo `groupId`, `meetingId` và ACL bằng Bedrock Knowledge Bases/S3 Vectors; trả kết quả kèm link nguồn và tuyệt đối không lấy dữ liệu nhóm khác. |
| FR-36 | Có thể có | Phân tích tiến độ | AI có thể diễn giải số liệu task được backend tính xác định; không dùng participant/transcript của Google Meet để chấm điểm hoặc xếp hạng con người, và không tự bịa số liệu. |

## 6.1 Yêu cầu tích hợp Google Calendar / Google Meet

| Mã | Yêu cầu |
| --- | --- |
| INT-01 | Dùng OAuth 2.0 Authorization Code Flow; đăng ký đúng redirect URI cho môi trường local và môi trường triển khai. |
| INT-02 | Máy chủ giữ access token/refresh token; trình duyệt chỉ nhận trạng thái kết nối và dữ liệu cần hiển thị. |
| INT-03 | Mỗi sự kiện dùng `conferenceDataVersion = 1` và `requestId` riêng khi yêu cầu tạo dữ liệu hội nghị. |
| INT-04 | Khi trạng thái còn chờ, hệ thống kiểm tra hoặc thử lại có giới hạn; không tạo event mới chỉ để thử lại một yêu cầu đang chờ. |
| INT-05 | Khi sửa/hủy, hệ thống phân biệt lỗi có thể thử lại và lỗi không thể thử lại; giao diện hiển thị rõ dữ liệu nội bộ đã lưu nhưng đồng bộ Google đang chờ hoặc thất bại. |
| INT-06 | Sau cuộc họp, Meet Artifact Adapter dùng `googleSpaceName`/`conferenceRecordName` để lấy participants, recordings và transcripts khi artifact tồn tại và OAuth scope cho phép; không dùng meeting code làm định danh dài hạn. [TL9][TL10] |
| INT-07 | Khi artifact Google không có, chưa sẵn sàng, hết quyền hoặc không hỗ trợ tiếng Việt, giao diện cho phép upload thủ công hoặc dùng recording được đồng ý; lỗi này không làm mất biên bản/task nội bộ. |
| INT-08 | MVP dùng nút đồng bộ hoặc polling có giới hạn từ EventBridge sau giờ kết thúc. Google Workspace Events/Pub/Sub chỉ là lựa chọn hậu MVP vì bổ sung phụ thuộc Google Cloud. [TL20] |
| INT-09 | OAuth dùng scope tối thiểu; scope Drive/Meet hạn chế chỉ được yêu cầu khi người dùng bật đồng bộ artifact, đồng thời phải hiển thị rõ dữ liệu nào CampusMeet sẽ đọc/lưu. |
| INT-10 | CampusMeet vẫn là web app chính. Meet Add-on chỉ cung cấp route side panel/main stage tối giản cho trải nghiệm trong cuộc họp, dùng chung API, dữ liệu, authorization và audit; không tạo backend hoặc nguồn dữ liệu riêng. [TL22][TL23] |
| INT-11 | Add-on được host trên HTTPS origin do nhóm sở hữu, khai báo `sidePanelUrl`/`addOnOrigins` trong manifest và dùng `getMeetingInfo()` để ánh xạ `meetingId`/`meetingCode` hiện tại với meeting nội bộ. Không dùng iframe thông thường để nhúng toàn bộ giao diện Google Meet vào CampusMeet. [TL22][TL23][TL26] |
| INT-12 | Phân phối add-on theo ba mức: deployment chưa công bố để phát triển/demo; private Marketplace cho cùng Google Workspace organization; public Marketplace cho người dùng bên ngoài sau Google review và OAuth verification nếu scope yêu cầu. Audience private/public phải được chốt trước khi publish vì không đổi được sau đó. [TL24][TL25] |

# 7. Mô tả các Use Case chính

Các use Case sử dụng dưới đây mô tả các luồng nghiệp vụ quan trọng. Chúng không phải là danh sách màn hình hay API; mỗi use case cho biết ai thực hiện, điều kiện cần có, các bước chính, tình huống lỗi và kết quả mong đợi.

### 7.1 Tạo nhóm

| Thuộc tính | Nội dung |
| --- | --- |
| Người thực hiện | Thành viên |
| Mục tiêu | Tạo một không gian chung cho lớp hoặc nhóm dự án. |
| Điều kiện trước | • Người dùng đã đăng nhập.<br>• Tên nhóm không rỗng và không vượt giới hạn. |
| Luồng chính | 1. Chọn chức năng Tạo nhóm.<br>2. Nhập tên, mô tả và nhãn tùy chọn.<br>3. Hệ thống kiểm tra dữ liệu.<br>4. Hệ thống tạo nhóm và thêm người tạo với quyền Quản trị viên nhóm.<br>5. Hiển thị bảng tổng quan của nhóm mới. |
| Ngoại lệ / lỗi | Nếu tên nhóm không hợp lệ, hệ thống hiển thị lỗi kiểm tra dữ liệu và không tạo nhóm. |
| Kết quả | Nhóm và quyền quản trị của người tạo được lưu thành công. |

### 7.2 Mời thành viên tham gia nhóm

| Thuộc tính | Nội dung |
| --- | --- |
| Người thực hiện | Quản trị viên nhóm và Thành viên |
| Mục tiêu | Thêm thành viên vào nhóm theo cách có kiểm soát. |
| Điều kiện trước | • Quản trị viên thuộc nhóm.<br>• Địa chỉ email hoặc người nhận hợp lệ. |
| Luồng chính | 1. Quản trị viên tạo lời mời bằng email hoặc liên kết.<br>2. Hệ thống lưu lời mời ở trạng thái chờ với thời hạn.<br>3. Người nhận mở liên kết và đăng nhập/đăng ký.<br>4. Người nhận chấp nhận hoặc từ chối lời mời.<br>5. Nếu chấp nhận, hệ thống tạo quyền thành viên cho nhóm. |
| Ngoại lệ / lỗi | Lời mời hết hạn hoặc bị thu hồi sẽ hiển thị lý do; quản trị viên có thể tạo lời mời mới. |
| Kết quả | Thành viên được cấp quyền xem dữ liệu của nhóm theo vai trò. |

### 7.3 Lập lịch họp và yêu cầu liên kết Google Meet

| Thuộc tính | Nội dung |
| --- | --- |
| Người thực hiện | Quản trị viên nhóm / Người tổ chức cuộc họp |
| Mục tiêu | Tạo cuộc họp có nội dung, người tham dự, nhắc lịch và sự kiện Google Calendar. |
| Điều kiện trước | • Quản trị viên có quyền với nhóm.<br>• Người tổ chức đã kết nối Google hoặc nhóm chấp nhận lưu cuộc họp nội bộ chưa đồng bộ. |
| Luồng chính | 1. Nhập thông tin cuộc họp và chọn người tổ chức.<br>2. Hệ thống kiểm tra thời gian, người tham dự và mốc nhắc.<br>3. Hệ thống lưu cuộc họp nội bộ với trạng thái phù hợp.<br>4. Nếu Google đã kết nối, Lambda gọi Calendar API để tạo event và yêu cầu dữ liệu hội nghị.<br>5. Hệ thống lưu `googleEventId` và trạng thái đồng bộ.<br>6. Hệ thống tạo các lịch nhắc hợp lệ.<br>7. Giao diện hiển thị rõ `PENDING`, `READY` hoặc `FAILED`. |
| Ngoại lệ / lỗi | Nếu Google API hết thời gian phản hồi, cuộc họp nội bộ vẫn tồn tại và hiển thị nút Thử lại đồng bộ Google. |
| Kết quả | Cuộc họp được lên lịch; chỉ hiển thị liên kết Meet khi trạng thái là `READY`. |

### 7.4 Sửa hoặc hủy cuộc họp

| Thuộc tính | Nội dung |
| --- | --- |
| Người thực hiện | Quản trị viên nhóm |
| Mục tiêu | Cập nhật dữ liệu nội bộ và đồng bộ Google Calendar an toàn. |
| Điều kiện trước | • Cuộc họp thuộc nhóm của quản trị viên.<br>• Cuộc họp chưa hoàn thành hoặc chưa bị hủy. |
| Luồng chính | 1. Cập nhật thời gian, nội dung họp, người tham dự hoặc chọn hủy.<br>2. Hệ thống cập nhật dữ liệu nội bộ và nhật ký thao tác.<br>3. Hệ thống thay thế hoặc hủy các lịch nhắc cũ.<br>4. Nếu Google event tồn tại, hệ thống gọi API cập nhật/hủy theo chính sách.<br>5. Giao diện hiển thị kết quả đồng bộ. |
| Ngoại lệ / lỗi | Nếu đồng bộ Google thất bại, thay đổi nội bộ vẫn được giữ và hiển thị trạng thái cần thử lại. |
| Kết quả | Không gửi thông báo nhắc lịch cũ sau khi cuộc họp bị hủy hợp lệ. |

### 7.5 Gửi thông báo nhắc lịch

| Thuộc tính | Nội dung |
| --- | --- |
| Người thực hiện | Hệ thống |
| Mục tiêu | Nhắc đúng thành viên trước thời gian họp. |
| Điều kiện trước | • Thông báo đã được lên lịch.<br>• Cuộc họp đang hoạt động và chưa bị hủy. |
| Luồng chính | 1. EventBridge Scheduler gọi Reminder Lambda.<br>2. Lambda đọc cuộc họp và tùy chọn nhận thông báo.<br>3. Lambda tạo thông báo trong ứng dụng.<br>4. Nếu đủ điều kiện, Lambda thử gửi email qua SES.<br>5. Lambda lưu kết quả và metric. |
| Ngoại lệ / lỗi | Nếu gửi email thất bại, thông báo trong ứng dụng vẫn được tạo và metric lỗi email tăng. |
| Kết quả | Có bản ghi quan sát được cho từng lần nhắc lịch. |

### 7.6 Ghi biên bản và tạo công việc

| Thuộc tính | Nội dung |
| --- | --- |
| Người thực hiện | Quản trị viên nhóm hoặc người được cấp quyền ghi biên bản |
| Mục tiêu | Chuyển kết quả họp thành công việc có trách nhiệm rõ ràng. |
| Điều kiện trước | • Cuộc họp đã tồn tại.<br>• Người thao tác có quyền ghi biên bản. |
| Luồng chính | 1. Lưu tóm tắt, nội dung thảo luận, quyết định và việc cần thực hiện.<br>2. Chọn chuyển việc cần thực hiện thành công việc.<br>3. Hệ thống kiểm tra người phụ trách đang là thành viên hoạt động.<br>4. Tạo công việc liên kết tới cuộc họp và biên bản nguồn. |
| Ngoại lệ / lỗi | Nếu chưa chọn người phụ trách, hệ thống cho phép lưu việc cần thực hiện nhưng chưa cho tạo công việc. |
| Kết quả | Biên bản và công việc có liên kết để truy vết nguồn. |

### 7.7 Cập nhật công việc và xem bảng tổng quan

| Thuộc tính | Nội dung |
| --- | --- |
| Người thực hiện | Thành viên / Quản trị viên nhóm |
| Mục tiêu | Cập nhật tiến độ công việc và nhận biết những việc cần chú ý. |
| Điều kiện trước | • Người thao tác là người phụ trách hoặc Quản trị viên nhóm.<br>• Công việc thuộc nhóm mà người dùng có quyền truy cập. |
| Luồng chính | 1. Thành viên cập nhật trạng thái công việc.<br>2. Hệ thống kiểm tra quyền và lưu người thao tác, thời điểm cập nhật.<br>3. Khi hoàn thành, hệ thống lưu thời điểm hoàn thành.<br>4. Người dùng mở bảng tổng quan cá nhân hoặc nhóm.<br>5. Hệ thống chỉ tổng hợp dữ liệu thuộc các nhóm người dùng có quyền truy cập. |
| Ngoại lệ / lỗi | Nếu người dùng không có quyền, hệ thống trả lỗi 403 và không thay đổi dữ liệu. |
| Kết quả | Bảng tổng quan hiển thị cuộc họp sắp tới, việc sắp đến hạn, quá hạn và mức độ hoàn thành. |

### 7.8 Quan sát cảnh báo và xử lý lỗi vận hành

| Thuộc tính | Nội dung |
| --- | --- |
| Người thực hiện | Người phụ trách vận hành của nhóm |
| Mục tiêu | Chứng minh hệ thống có khả năng quan sát và hỗ trợ điều tra lỗi. |
| Điều kiện trước | • CloudWatch log, metric, alarm đã được cấu hình.<br>• Đăng ký nhận SNS đã được xác nhận. |
| Luồng chính | 1. Thực hiện một yêu cầu kiểm thử có chủ đích để tạo metric lỗi.<br>2. CloudWatch Alarm chuyển sang trạng thái ALARM.<br>3. SNS gửi thông báo cho người phụ trách.<br>4. Người phụ trách kiểm tra log theo `requestId` và ghi nhận cách xử lý. |
| Ngoại lệ / lỗi | Nếu email SNS chưa xác nhận, nhóm ghi nhận trạng thái chờ và vẫn trình bày trạng thái alarm trên CloudWatch. |
| Kết quả | Có ảnh chụp alarm, log, tình huống kiểm thử và ghi chú dọn dẹp tài nguyên. |

### 7.9 Tương tác với Trợ lý AI (Hỏi đáp, Sinh Biên bản & Đề xuất Task)

| Thuộc tính | Nội dung |
| --- | --- |
| Người thực hiện | Quản trị viên nhóm / Thành viên |
| Mục tiêu | Hỏi đáp tài liệu/transcript có nguồn, tạo bản nháp biên bản/action item và hỗ trợ thao tác bằng ngôn ngữ tự nhiên mà không bỏ qua quyền hoặc sự xác nhận của người dùng. |
| Điều kiện trước | • Người dùng là thành viên đang hoạt động của nhóm.<br>• Có ít nhất một nguồn đã xử lý thành công: tài liệu, transcript hoặc biên bản.<br>• Nguồn và conversation đều mang `groupId`/ACL. |
| Luồng hỏi đáp | 1. Mở Chatbot trong CampusMeet web hoặc Meet Add-on side panel; Document PiP chỉ dùng khi cần fallback và trình duyệt hỗ trợ.<br>2. Add-on lấy meeting context và ánh xạ với meeting nội bộ, nhưng vẫn gọi cùng API có authorization.<br>3. Chọn phạm vi một cuộc họp hoặc toàn nhóm.<br>4. Có thể upload file qua presigned URL.<br>5. Hệ thống truy xuất nguồn trong đúng phạm vi quyền.<br>6. Bedrock trả lời kèm citation; người dùng mở citation để kiểm tra. |
| Luồng ghi âm/transcript | 1. Người dùng bấm Ghi âm và xác nhận nguồn capture/consent.<br>2. Audio upload trực tiếp lên S3.<br>3. AI job chạy STT bất đồng bộ và tạo segment có timestamp/confidence/speaker label.<br>4. Người có quyền nghe lại, sửa text và ánh xạ speaker trước khi dùng làm nguồn chính thức. |
| Luồng sau họp | 1. Người có quyền bấm Tạo bản nháp biên bản.<br>2. AI sinh tóm tắt, quyết định và action item cùng citation.<br>3. Người dùng duyệt/chỉnh sửa.<br>4. Chỉ action item được xác nhận mới được chuyển thành task. |
| Luồng hành động | 1. Người dùng yêu cầu tạo nhóm/cuộc họp/task hoặc cập nhật task.<br>2. Bedrock chọn tool trong allowlist và trả `ToolProposal`.<br>3. Backend kiểm tra schema, quyền và quy tắc nghiệp vụ.<br>4. Frontend hiển thị form preview.<br>5. Người dùng xác nhận; backend gọi API chuẩn và ghi audit log. |
| Luồng truy xuất (RAG) | 1. Người dùng hỏi về các cuộc họp cũ trong một nhóm.<br>2. Knowledge Base lọc theo `groupId`/ACL và tìm đoạn liên quan.<br>3. AI trả lời kèm link tới meeting/file/transcript segment; nếu không đủ nguồn thì trả lời không xác định. |
| Luồng phân tích | Backend tính số liệu task theo quy tắc xác định; AI chỉ diễn giải kết quả. Không dùng Meet participant/transcript để tự động chấm điểm hoặc xếp hạng thành viên. |
| Ngoại lệ / lỗi | Khi upload/STT/Bedrock/ingestion lỗi, `AIJob` chuyển sang `FAILED` với mã an toàn, có retry giới hạn hoặc fallback nhập/sửa thủ công. Nếu add-on chưa được cài, bị quản trị viên chặn hoặc iframe/auth lỗi thì mở panel trong CampusMeet web; Document PiP chỉ là fallback bổ sung. |
| Kết quả | Nội dung AI có thể kiểm chứng, không ghi dữ liệu trái phép và không được coi là chính xác cho tới khi người dùng có quyền duyệt. |

# 8. User Story

Nội dung được diễn đạt thành các đoạn nghiệp vụ hoàn chỉnh để cả nhóm dễ hiểu người dùng cần gì, vì sao cần và hệ thống phải hỗ trợ ra sao. Các yêu cầu chi tiết đã được thể hiện ở Mục 6 và các luồng thực hiện ở Mục 7.

## 8.1 Quản trị viên nhóm

Quản trị viên nhóm cần một nơi tập trung để tạo nhóm học tập hoặc nhóm dự án, mời thành viên, lập lịch họp, chọn người tham dự và theo dõi phần việc sau họp. Thay vì phải tạo lịch ở Google Calendar, gửi liên kết Meet qua chat và giao việc bằng một công cụ khác, quản trị viên cần thực hiện các bước đó trong CampusMeet để thông tin không bị tách rời.

Sau cuộc họp, quản trị viên cần lưu biên bản, các quyết định và việc cần thực hiện. Mỗi công việc cần có người phụ trách, mức ưu tiên và hạn hoàn thành để việc đã thống nhất không bị thất lạc hoặc không có người chịu trách nhiệm.

## 8.2 Người tổ chức cuộc họp

Người tổ chức cuộc họp cần có thể kết nối tài khoản Google của mình để CampusMeet tạo Google Calendar event và yêu cầu tạo liên kết Google Meet. Mục tiêu là giảm thao tác thủ công, đồng thời vẫn cho người dùng biết rõ liên kết đang được tạo, đã sẵn sàng hay cần kết nối lại Google. Hệ thống không được hiển thị liên kết giả khi Google chưa trả kết quả.

## 8.3 Thành viên nhóm

Thành viên cần xem được lịch họp thuộc các nhóm mà mình tham gia, nhận thông báo nhắc lịch, mở đúng liên kết Google Meet và theo dõi công việc được giao. Khi hoàn thành hoặc đang thực hiện một công việc, thành viên cần cập nhật trạng thái để quản trị viên và các thành viên liên quan biết tiến độ hiện tại.

## 8.4 Người ghi biên bản

Người được giao ghi biên bản cần lưu được nội dung thảo luận, quyết định và việc cần thực hiện ngay sau cuộc họp. Việc chuyển một nội dung trong biên bản thành công việc cần đơn giản, nhưng hệ thống phải kiểm tra người phụ trách có thuộc nhóm hay không để tránh giao việc cho người không có quyền truy cập.

## 8.5 Người phụ trách vận hành

Người phụ trách vận hành cần kiểm tra log, metric và cảnh báo để biết hệ thống có lỗi ở đâu; đồng thời có hướng dẫn triển khai và dọn dẹp rõ ràng để tránh phát sinh chi phí ngoài ý muốn. Đây là nhu cầu vận hành của nhóm phát triển, không phải một vai trò sử dụng nghiệp vụ trong CampusMeet.

# 9. Quy tắc nghiệp vụ, trạng thái và dữ liệu

## 9.1 Quy tắc nghiệp vụ

| Mã | Quy tắc |
| --- | --- |
| BR-01 | Mỗi nhóm luôn có ít nhất một Quản trị viên nhóm đang hoạt động. |
| BR-02 | Chỉ thành viên đang hoạt động mới được chọn làm người tham dự hoặc người phụ trách công việc. |
| BR-03 | Thời điểm bắt đầu/kết thúc được lưu theo UTC; giao diện quy đổi theo múi giờ của người dùng. |
| BR-04 | Mỗi cuộc họp có một người tổ chức; người này phải là thành viên đang hoạt động của nhóm. |
| BR-05 | Liên kết Google Meet chỉ hiển thị khi người dùng thuộc nhóm và trạng thái đồng bộ là `READY`. |
| BR-06 | Mỗi yêu cầu tạo dữ liệu hội nghị của Google event phải dùng `requestId` riêng; không dùng lại dữ liệu hội nghị của event khác. [TL1][TL2] |
| BR-07 | Khi hủy cuộc họp, hệ thống phải vô hiệu hoặc xóa các lịch nhắc còn hiệu lực trước khi có thông báo mới được gửi. |
| BR-08 | Công việc quá hạn là điều kiện tính toán: thời điểm hiện tại vượt hạn hoàn thành và trạng thái không phải `DONE`; người dùng không tự chọn trạng thái này. |
| BR-09 | Gửi email thất bại không được hoàn tác thông báo trong ứng dụng hoặc dữ liệu cuộc họp/công việc. |
| BR-10 | Các thao tác có tác dụng phụ phải dùng idempotency key hoặc cơ chế tương đương để thao tác thử lại không tạo kết quả trùng. [TL5] |
| BR-11 | Không ghi access token, refresh token, mật khẩu, authorization code hoặc dữ liệu cá nhân thô vào log ứng dụng. |
| BR-12 | Cuộc họp đã hủy hoặc hoàn thành vẫn giữ lịch sử nhật ký; MVP không xóa cứng các bản ghi nghiệp vụ. |
| BR-13 | Recording chỉ bắt đầu sau thao tác đồng ý rõ ràng; giao diện luôn hiển thị trạng thái và nguồn capture. Người không đồng ý có thể rời cuộc họp hoặc không dùng tính năng recording. |
| BR-14 | STT/diarization chỉ tạo speaker label ẩn danh. Chỉ ánh xạ sang thành viên sau khi người có quyền xác nhận; LLM không được tự đoán danh tính từ giọng nói hoặc ngữ cảnh. |
| BR-15 | AI output là bản nháp. Câu trả lời và nội dung sinh phải giữ citation; khi không đủ bằng chứng phải trả lời không xác định thay vì bịa. |
| BR-16 | Tool use không bỏ qua API nghiệp vụ: mọi đề xuất ghi dữ liệu phải qua schema validation, kiểm tra quyền, xác nhận, idempotency và audit log. Nội dung tài liệu/transcript không được phép trực tiếp kích hoạt tool. [TL15] |
| BR-17 | Mọi ingestion/retrieval phải mang `groupId` và ACL. Query RAG phải lọc quyền trước khi lấy đoạn nguồn; không chỉ lọc sau khi model đã nhận dữ liệu. |
| BR-18 | Tệp upload phải dùng presigned URL, allowlist MIME/đuôi file, giới hạn kích thước, checksum và trạng thái kiểm tra an toàn; file chưa đạt không được đưa vào parser/model. |
| BR-19 | Người dùng có quyền có thể sửa transcript; mỗi lần sửa lưu người sửa, thời điểm và phiên bản. Audio gốc và transcript áp dụng retention/xóa theo chính sách nhóm. |
| BR-20 | Phân tích tiến độ chỉ dùng số liệu task/meeting do backend tính xác định. Không dùng dữ liệu Google Meet để tự động chấm điểm, suy diễn thái độ hoặc xếp hạng người tham dự. [TL9] |

## 9.2 Vòng đời trạng thái

> **Ghi chú:** Vòng đời cuộc họp và trạng thái tích hợp là hai trường độc lập.<br>Vòng đời cuộc họp: `DRAFT` → `SCHEDULED` → `COMPLETED`; trước khi hoàn thành có thể chuyển sang `CANCELLED`.<br>Trạng thái Google: `NOT_REQUESTED` → `PENDING` → `READY \| FAILED_RETRYABLE \| ACTION_REQUIRED`.<br>Trạng thái Google artifact: `NOT_REQUESTED` → `POLLING` → `AVAILABLE \| UNAVAILABLE \| FAILED`.<br>Vòng đời AI job: `QUEUED` → `PROCESSING` → `COMPLETED \| FAILED \| CANCELLED`.<br>Vòng đời công việc: `TODO` ↔ `DOING` → `DONE`; công việc hoàn thành có thể được mở lại và chuyển về `DOING`.<br>Vòng đời lời mời: `PENDING` → `ACCEPTED \| DECLINED \| EXPIRED \| REVOKED`.<br>Vòng đời nhắc lịch: `SCHEDULED` → `PROCESSING` → `SENT \| FAILED \| CANCELLED`.

## 9.3 Mô hình dữ liệu logic

| Thực thể | Thuộc tính chính | Quan hệ |
| --- | --- | --- |
| Người dùng | `userId`, `cognitoSub`, email, tên hiển thị, múi giờ, tùy chọn thông báo | Có nhiều quyền thành viên và thông báo. |
| Nhóm | `groupId`, tên, mô tả, người tạo, thời điểm tạo | Có nhiều thành viên, cuộc họp, công việc và nhật ký. |
| Quyền thành viên | `groupId`, `userId`, vai trò, trạng thái, thời điểm tham gia | Liên kết giữa người dùng và nhóm; là cơ sở phân quyền. |
| Lời mời | `invitationId`, `groupId`, email, tokenHash, thời hạn, trạng thái | Thuộc nhóm; có thể tạo quyền thành viên sau khi chấp nhận. |
| Cuộc họp | `meetingId`, `groupId`, người tổ chức, tiêu đề, agenda, thời gian, `meetingStatus`, `googleSyncStatus`, `googleEventId`, `googleSpaceName`, `conferenceRecordName`, `meetUrlRef` | Có người tham dự, nhắc lịch, một biên bản, nhiều công việc và artifact. |
| Nhắc lịch | `reminderId`, `meetingId`, mốc nhắc, thời điểm chạy, trạng thái | Thuộc một cuộc họp. |
| Biên bản | `minutesId`, `meetingId`, tóm tắt, thảo luận, quyết định, người tạo | Một biên bản cho một cuộc họp; là nguồn của công việc. |
| Công việc | `taskId`, `groupId`, nguồn cuộc họp/biên bản, tiêu đề, người phụ trách, hạn, ưu tiên, trạng thái | Thuộc nhóm; có thể tham chiếu cuộc họp/biên bản. |
| Thông báo | `notificationId`, `userId`, loại, đối tượng, nội dung, thời điểm đã đọc | Thuộc người dùng. |
| Nhật ký | `auditId`, `groupId`, người thao tác, hành động, đối tượng, thời điểm | Thuộc nhóm; chỉ lưu dữ liệu an toàn. |
| Tệp đính kèm | `attachmentId`, `groupId`, `meetingId`, `s3Key`, MIME, kích thước, checksum, trạng thái scan/ingestion, người tải | Metadata thuộc DynamoDB; nội dung nằm trong S3 private. |
| Recording | `recordingId`, `groupId`, `meetingId`, nguồn (`GOOGLE/UPLOAD/CAPTURE`), `s3Key` hoặc Google ref, trạng thái, thời lượng, retention | Có nhiều consent record và có thể sinh một transcript. |
| Recording consent | `recordingId`, `userId`, quyết định, thời điểm, phiên bản thông báo | Là bằng chứng thao tác đồng ý/từ chối, không phải nhận diện sinh trắc học. |
| Transcript | `transcriptId`, `groupId`, `meetingId`, provider, ngôn ngữ, trạng thái, phiên bản | Có nhiều segment và là nguồn cho AI. |
| Transcript segment | `transcriptId`, `segmentId`, start/end, text, confidence, speakerLabel, `speakerUserId` tùy chọn, người sửa | Cho phép nghe lại, chỉnh sửa và citation đến đoạn cụ thể. |
| AI job | `aiJobId`, `groupId`, loại, trạng thái, input refs, output ref, model/provider, token/chi phí, lỗi an toàn | Theo dõi parse, STT, ingestion và generation bất đồng bộ. |
| Hội thoại AI | `conversationId`, `groupId`, `meetingId` tùy chọn, người dùng, phạm vi | Có message và citation; không lưu prompt nhạy cảm vào log. |
| Tool proposal | `proposalId`, `groupId`, người yêu cầu, tool, tham số, trạng thái, thời hạn, xác nhận | Chỉ thực thi một lần sau kiểm tra quyền và xác nhận. |

## 9.4 Thiết kế DynamoDB đề xuất

Trong 8 tuần, nhóm nên dùng nhiều bảng theo miền nghiệp vụ thay vì ép toàn bộ dữ liệu vào single-table design. Cách này dễ kiểm tra, dễ phân chia việc và phù hợp với quy mô demo. Sau khi MVP ổn định, nhóm có thể đánh giá lại khả năng tối ưu hóa bảng.

| Bảng | Khóa chính | Mẫu truy cập chính / chỉ mục |
| --- | --- | --- |
| Groups | `groupId` | Lấy thông tin nhóm; có thể tạo chỉ mục theo người tạo nếu cần. |
| Memberships | `groupId#userId` | Tìm nhóm theo `userId`; kiểm tra quyền truy cập. |
| Meetings | `meetingId` | Chỉ mục theo `groupId#startAtUtc`, theo người tổ chức và theo Google event. |
| Tasks | `taskId` | Chỉ mục theo `assigneeId#dueAtUtc` và `groupId#status#dueAtUtc`. |
| Notifications | `notificationId` | Chỉ mục theo `userId#createdAt`. |
| Invitations | `invitationId` | Chỉ mục theo `tokenHash` và `groupId#status`. |
| AuditLogs | `auditId` | Chỉ mục theo `groupId#createdAt`. |
| Attachments | `attachmentId` | Chỉ mục theo `meetingId#createdAt` và `groupId#status`; S3 giữ nội dung. |
| Recordings | `recordingId` | Chỉ mục theo `meetingId#createdAt`; lưu nguồn, consent/retention và artifact ref. |
| Transcripts | `transcriptId` + `segmentId` | Query segment theo transcript/timestamp; GSI theo `meetingId#version`. |
| AIJobs | `aiJobId` | Chỉ mục theo `groupId#createdAt` và `status#updatedAt`; TTL cho job tạm nếu phù hợp. |
| AIConversations | `conversationId` + `messageId` | Query hội thoại theo người dùng/phạm vi; citation tham chiếu nguồn ổn định. |
| ToolProposals | `proposalId` | Chỉ mục theo `userId#status`; conditional write bảo đảm xác nhận/thực thi một lần. |

Nội dung RAG không lưu trong DynamoDB. Tài liệu/transcript chuẩn hóa được đồng bộ vào Bedrock Knowledge Bases; vector và metadata quyền nằm trong S3 Vectors. Mọi vector phải mang tối thiểu `groupId`, `meetingId`, `sourceType` và `sourceId`. [TL16][TL17]

# 10. Kiến trúc giải pháp AWS và lý do lựa chọn

## 10.1 Kiến trúc đề xuất

CampusMeet sử dụng kiến trúc serverless và dịch vụ managed để giảm vận hành, giảm chi phí cố định và phù hợp thời gian 8 tuần. Phần AI chạy bất đồng bộ, không tải audio/tài liệu lớn qua API Gateway và không giữ Lambda chờ STT/ingestion hoàn tất. Sơ đồ kiến trúc chính thức cần vẽ rõ khung AWS Cloud, AWS Region, lớp global/edge và các hệ thống bên ngoài AWS. Không đưa Lambda vào VPC chỉ để có VPC: MVP không có tài nguyên private bắt buộc, trong khi NAT Gateway làm tăng chi phí và độ phức tạp.

> **Ghi chú:** Bên ngoài AWS Cloud: Người dùng/Browser, Google OAuth + Google Calendar API + Google Meet REST API, người nhận email và người phụ trách nhận cảnh báo. Deepgram chỉ xuất hiện nếu benchmark chọn provider này thay Amazon Transcribe.<br><br>Lớp global/edge: CloudFront.<br><br>Trong AWS Region: S3 private static assets, S3 user-content, Cognito User Pool, API Gateway, Lambda API, DynamoDB, EventBridge Scheduler, Reminder Lambda, Step Functions, AI Worker Lambda, Amazon Transcribe, Amazon Bedrock, Bedrock Knowledge Bases, S3 Vectors, SES, CloudWatch, SNS và Secrets Manager hoặc Systems Manager Parameter Store.

## 10.2 Luồng kiến trúc cần đánh số trên sơ đồ

| Số | Mô tả |
| --- | --- |
| 1 | Người dùng mở CampusMeet trên trình duyệt. |
| 2 | CloudFront phân phối static assets của React/Next.js từ S3 private REST origin thông qua OAC. |
| 3 | Người dùng đăng nhập qua Cognito; trình duyệt nhận JWT theo thiết kế xác thực. |
| 4 | Trình duyệt gọi API Gateway qua HTTPS, kèm access token. |
| 5 | API Gateway kiểm tra JWT; Lambda API nhận yêu cầu hợp lệ. |
| 6 | Lambda kiểm tra quyền thành viên theo `groupId`, sau đó đọc/ghi DynamoDB. |
| 7 | Người tổ chức bắt đầu Google OAuth; callback quay về backend; token được lưu phía máy chủ. |
| 8 | Khi tạo cuộc họp, Lambda lưu bản ghi nội bộ trước cùng idempotency key và trạng thái đồng bộ. |
| 9 | Module tích hợp gọi Google Calendar API để tạo/cập nhật event và yêu cầu dữ liệu hội nghị. |
| 10 | Hệ thống lưu `googleEventId`, trạng thái hội nghị và chỉ lưu/hiển thị join URL khi `READY`. |
| 11 | Lambda tạo hoặc cập nhật các one-time schedule trên EventBridge Scheduler theo mốc nhắc. |
| 12 | Scheduler gọi Reminder Lambda bất đồng bộ vào thời điểm đã định. |
| 13 | Reminder Lambda kiểm tra cuộc họp chưa bị hủy, tạo thông báo DynamoDB và thử gửi email SES nếu đủ điều kiện. |
| 14 | API Lambda và Reminder Lambda gửi log có cấu trúc cùng metric đến CloudWatch. |
| 15 | CloudWatch Alarm vượt ngưỡng gửi SNS tới người phụ trách. |
| 16 | Nhóm dùng IaC để triển khai/dọn dẹp và dùng bằng chứng CloudWatch để kiểm thử vận hành. |
| 17 | Sau khi kiểm tra quyền và metadata, API Lambda sinh S3 presigned URL; Browser upload tài liệu/audio trực tiếp vào S3 user-content kèm checksum, không đi qua API Gateway/Lambda payload. |
| 18 | Browser xác nhận upload; backend kiểm tra allowlist/kích thước/trạng thái an toàn rồi tạo `AIJob`. |
| 19 | Step Functions điều phối parse/STT/ingestion bất đồng bộ; Amazon Transcribe `vi-VN` là provider mặc định, Deepgram là adapter thay thế sau benchmark. |
| 20 | STT trả transcript segment có timestamp, confidence và speaker label ẩn danh; backend lưu metadata/segment và version vào DynamoDB, audio vẫn ở S3 private. |
| 21 | Tài liệu/transcript đã duyệt được đồng bộ vào Bedrock Knowledge Bases; embedding/vector cùng metadata `groupId`/ACL nằm trong S3 Vectors. |
| 22 | Câu hỏi AI đi qua Lambda kiểm tra quyền; Knowledge Base truy xuất nguồn có filter; Bedrock sinh câu trả lời/biên bản/action item kèm citation. |
| 23 | Với tool use, Bedrock chỉ trả `ToolProposal`; backend kiểm tra schema/quyền và frontend hiển thị preview. Sau xác nhận, API nghiệp vụ chuẩn mới thực thi và ghi audit log. |
| 24 | Sau giờ họp hoặc khi người dùng yêu cầu, Google Artifact Adapter dùng Meet REST API để kiểm tra conference record/recording/transcript; nếu không có thì hiển thị fallback upload/capture. |
| 25 | AI job, STT, Bedrock, ingestion và tool execution gửi log/metric không chứa nội dung nhạy cảm vào CloudWatch; lỗi/chi phí vượt ngưỡng kích hoạt cảnh báo. |
| 26 | Khi người dùng mở CampusMeet Meet Add-on, Google Meet tải route side panel HTTPS từ cùng CloudFront origin; add-on lấy meeting context và gọi lại cùng API Gateway/Cognito boundary, không bỏ qua authorization. [TL22][TL23] |
| 27 | Nếu add-on chưa cài, bị quản trị viên chặn hoặc không tải được, Chatbot tiếp tục hoạt động trong CampusMeet web. Document PiP chỉ là fallback phía Browser; mất PiP không làm mất dữ liệu. [TL18][TL24] |

## 10.3 Dịch vụ và lý do lựa chọn

| Dịch vụ | Lý do chọn | Lưu ý triển khai |
| --- | --- | --- |
| CloudFront + S3 | Phân phối giao diện tĩnh qua CDN; S3 private REST origin kết hợp OAC giúp CloudFront truy cập origin có kiểm soát. [TL4] | Không dùng public S3 website bucket. |
| Cognito User Pool | Cung cấp user directory và OIDC cho đăng ký/đăng nhập, JWT và MFA nếu cần. [TL6] | Có thể cấu hình chỉ mời nếu không muốn đăng ký công khai. |
| API Gateway HTTP API | Cổng HTTPS cho API, hỗ trợ JWT authorization và định tuyến tới Lambda. | Thống nhất phản hồi và hợp đồng lỗi. |
| AWS Lambda Node.js/TypeScript | Chạy API và tác vụ nền; package nhẹ và phù hợp full-stack TypeScript. | Không dùng Spring Boot Lambda trong MVP để giảm cold start và độ phức tạp. |
| DynamoDB | Cơ sở dữ liệu NoSQL managed cho nhóm, cuộc họp, công việc và thông báo. | Dùng nhiều bảng theo miền nghiệp vụ trong MVP. |
| EventBridge Scheduler | Tạo nhắc lịch tại một thời điểm cụ thể; hỗ trợ retry, retention và timezone. [TL3] | Cần execution role khi triển khai bằng IaC. |
| SES | Gửi email nhắc lịch tùy chọn. | SES sandbox giới hạn email gửi/nhận đã xác minh theo Region. [TL7] |
| CloudWatch + SNS | Log, metric, cảnh báo và thông báo vận hành. | Phải demo được ít nhất một cảnh báo. |
| Secrets Manager / SSM | Lưu Google OAuth client secret và cấu hình nhạy cảm. | Chỉ Lambda role cần thiết được đọc secret. |
| S3 user-content | Lưu tài liệu, audio và artifact người dùng bằng presigned upload. | Bucket private, mã hóa, CORS hẹp, lifecycle/retention và tách khỏi bucket frontend. |
| Step Functions + AI Worker | Điều phối parse, STT, Bedrock và ingestion dài hạn. | Không chờ trong API request; có trạng thái job, timeout, retry giới hạn và nhánh thất bại. |
| Amazon Transcribe | STT batch/streaming và speaker diarization; hỗ trợ `vi-VN`. [TL13][TL14] | Dùng batch trong AI MVP; benchmark với audio tiếng Việt thật trước khi chốt provider. |
| Amazon Bedrock | Hỏi đáp, sinh nội dung và tool use qua model cấu hình theo môi trường. [TL15] | Không hard-code tên model trong SRS; output là bản nháp và tool chỉ là đề xuất. |
| Bedrock Knowledge Bases + S3 Vectors | RAG trên tài liệu/transcript với metadata lọc quyền và citation. [TL16][TL17] | Chỉ ingest nguồn đã duyệt; filter `groupId`/ACL trước retrieval. |
| AWS CDK hoặc AWS SAM | Triển khai hạ tầng bằng mã, tái lập và dọn dẹp được. | Nhóm chọn duy nhất một công cụ. |

## 10.4 Trình tự tích hợp Google

- Kết nối Google: Trình duyệt → CampusMeet API → Google OAuth consent → callback → API kiểm tra state/PKCE (nếu áp dụng) → lưu token phía máy chủ → trả về trạng thái đã kết nối. Token refresh không được trả về trình duyệt.

- Tạo cuộc họp: Quản trị viên → API lưu cuộc họp nội bộ → API gọi Google Calendar tạo event và `conferenceData.createRequest` → lưu `googleSyncStatus` → tạo/cập nhật lịch nhắc.

- Thử lại đồng bộ: Chỉ kiểm tra event đã biết hoặc thử lại có giới hạn; không tạo event mới một cách mù quáng để tránh trùng event/liên kết.

- Đồng bộ artifact sau họp: Người dùng bấm đồng bộ hoặc EventBridge kích hoạt polling có giới hạn → adapter tìm conference record theo meeting space/event đã biết → lấy metadata participant/recording/transcript khi được phép → lưu reference hoặc đồng bộ nội dung theo consent/retention. Nếu artifact không tồn tại, hệ thống ghi `UNAVAILABLE` và cung cấp upload/capture; không coi đây là lỗi dữ liệu nội bộ. [TL9][TL10]

> **Ghi chú:** Lý do thiết kế: việc tạo dữ liệu hội nghị của Google Calendar có thể bất đồng bộ. Hành vi đúng của sản phẩm là có trạng thái hiển thị rõ, có thử lại có giới hạn và có nút Thử lại; không tạo liên kết giả và không lặp lại thao tác tạo event một cách không kiểm soát. [TL1][TL2]

# 11. API, bảo mật, quyền riêng tư và xử lý lỗi

## 11.1 Danh mục API chính

| Phương thức | Đường dẫn | Quyền | Mục đích |
| --- | --- | --- | --- |
| GET | /me | Đã xác thực | Lấy hồ sơ cá nhân. |
| PATCH | /me | Đã xác thực | Cập nhật tên hiển thị, múi giờ, tùy chọn thông báo. |
| POST | /groups | Đã xác thực | Tạo nhóm. |
| GET | /groups | Đã xác thực | Liệt kê các nhóm người dùng được phép xem. |
| GET | /groups/{groupId} | Thành viên | Lấy thông tin nhóm. |
| PATCH | /groups/{groupId} | Quản trị viên nhóm | Cập nhật nhóm. |
| POST | /groups/{groupId}/invitations | Quản trị viên nhóm | Tạo lời mời. |
| POST | /invitations/{token}/accept | Đã xác thực | Chấp nhận lời mời. |
| POST | /invitations/{token}/decline | Đã xác thực | Từ chối lời mời. |
| POST | /groups/{groupId}/meetings | Quản trị viên nhóm | Tạo cuộc họp và bắt đầu tích hợp bất đồng bộ. |
| GET | /groups/{groupId}/meetings | Thành viên | Lấy danh sách cuộc họp. |
| GET | /meetings/{meetingId} | Thành viên | Lấy chi tiết cuộc họp. |
| PATCH | /meetings/{meetingId} | Quản trị viên nhóm | Cập nhật cuộc họp. |
| POST | /meetings/{meetingId}/cancel | Quản trị viên nhóm | Hủy cuộc họp. |
| POST | /meetings/{meetingId}/retry-google-sync | Quản trị viên nhóm | Thử lại đồng bộ Google theo cơ chế idempotent. |
| PUT | /meetings/{meetingId}/minutes | Người có quyền ghi | Tạo/cập nhật biên bản. |
| POST | /meetings/{meetingId}/tasks | Người có quyền ghi | Tạo công việc từ cuộc họp. |
| GET | /groups/{groupId}/tasks | Thành viên | Lấy công việc được phép xem. |
| PATCH | /tasks/{taskId} | Người phụ trách / Quản trị viên | Cập nhật công việc. |
| GET | /dashboard/me | Đã xác thực | Lấy bảng tổng quan cá nhân. |
| GET | /groups/{groupId}/dashboard | Quản trị viên nhóm | Lấy bảng tổng quan nhóm. |
| GET | /notifications | Đã xác thực | Lấy thông báo của chính mình. |
| POST | /notifications/{id}/read | Đã xác thực | Đánh dấu đã đọc. |
| POST | /integrations/google/connect | Đã xác thực | Bắt đầu Google OAuth. |
| DELETE | /integrations/google | Đã xác thực | Ngắt kết nối Google. |
| POST | /meetings/{meetingId}/google-artifacts/sync | Quản trị viên / Người tổ chức | Bắt đầu kiểm tra Meet conference artifacts theo cơ chế idempotent. |
| POST | /meetings/{meetingId}/attachments/upload-url | Thành viên có quyền | Tạo presigned upload sau khi kiểm tra metadata file. |
| POST | /meetings/{meetingId}/attachments/{attachmentId}/complete | Người tải | Xác nhận upload/checksum và tạo job parse/ingestion. |
| GET | /meetings/{meetingId}/attachments | Thành viên | Liệt kê file và trạng thái scan/ingestion trong cuộc họp. |
| POST | /meetings/{meetingId}/recordings | Người có quyền ghi | Khởi tạo recording/upload với consent và source metadata. |
| POST | /meetings/{meetingId}/transcriptions | Người có quyền ghi | Tạo batch STT job từ recording đã hợp lệ. |
| GET | /meetings/{meetingId}/transcripts | Thành viên | Lấy transcript/version được phép xem. |
| PATCH | /transcripts/{transcriptId}/segments/{segmentId} | Người có quyền ghi | Sửa text hoặc ánh xạ speaker; lưu version/audit. |
| POST | /meetings/{meetingId}/ai/chat | Thành viên | Hỏi đáp trong phạm vi meeting, trả citation. |
| POST | /meetings/{meetingId}/ai/minutes-draft | Người có quyền ghi | Sinh bản nháp biên bản/action item, không tự lưu chính thức. |
| POST | /groups/{groupId}/ai/search | Thành viên | RAG nhiều cuộc họp với filter quyền/citation. |
| POST | /groups/{groupId}/ai/tool-proposals | Thành viên | Tạo đề xuất tool trong allowlist. |
| POST | /ai/tool-proposals/{proposalId}/confirm | Người tạo có quyền | Kiểm tra lại quyền và thực thi đề xuất một lần. |
| POST | /ai/tool-proposals/{proposalId}/cancel | Người tạo | Hủy đề xuất chưa thực thi. |
| GET | /ai/jobs/{aiJobId} | Thành viên có quyền nguồn | Lấy trạng thái/progress/lỗi an toàn của job bất đồng bộ. |

## 11.2 Hợp đồng phản hồi lỗi

Ví dụ phản hồi thành công bất đồng bộ `202 Accepted` khi lịch đã lưu nội bộ nhưng Google Meet đang được tạo:

```json
{
  "success": true,
  "data": {
    "meetingId": "...",
    "googleSyncStatus": "PENDING",
    "message": "Lịch đã được lưu. Google Meet đang được tạo."
  },
  "requestId": "req_01..."
}
```

| HTTP | Nhóm lỗi | Ví dụ mã | Cách giao diện xử lý |
| --- | --- | --- | --- |
| 400 | Dữ liệu không hợp lệ | `INVALID_MEETING_TIME` | Làm nổi bật trường lỗi; không tự thử lại. |
| 401 | Chưa xác thực | `UNAUTHENTICATED` | Yêu cầu đăng nhập. |
| 403 | Không có quyền | `FORBIDDEN_GROUP_ACCESS` | Không tiết lộ thêm dữ liệu nhạy cảm. |
| 404 | Không tìm thấy | `MEETING_NOT_FOUND` | Hiển thị trạng thái không tìm thấy. |
| 409 | Xung đột | `IDEMPOTENCY_CONFLICT` | Trả kết quả thao tác gốc khi có thể. |
| 413/415 | File không hợp lệ | `FILE_TOO_LARGE/UNSUPPORTED_MEDIA_TYPE` | Không cấp URL hoặc không đưa file vào pipeline. |
| 424/502 | Lỗi tích hợp | `GOOGLE_SYNC_FAILED_RETRYABLE` | Hiển thị nút thử lại; dữ liệu nội bộ vẫn giữ. |
| 422 | AI không đủ căn cứ | `INSUFFICIENT_GROUNDED_CONTEXT` | Không bịa câu trả lời; đề nghị chọn/thêm nguồn. |
| 429 | Giới hạn dịch vụ | `AI_RATE_LIMITED` | Chuyển job sang retry có giới hạn hoặc yêu cầu thử lại sau. |
| 500 | Lỗi nội bộ | `INTERNAL_ERROR` | Hiển thị thông báo chung và lưu `requestId` vào log. |

## 11.3 Bảo mật và quyền riêng tư

| Khu vực kiểm soát | Yêu cầu cơ bản |
| --- | --- |
| Xác thực | Dùng Cognito User Pool; kiểm tra JWT tại API Gateway và kiểm tra danh tính trong logic backend. [TL6] |
| Phân quyền | Bắt buộc kiểm tra quyền thành viên theo nhóm ở mỗi yêu cầu nghiệp vụ; không tin chỉ `groupId` do trình duyệt gửi. |
| Secret và token | Google client secret, access token và refresh token chỉ được lưu phía máy chủ, mã hóa khi lưu và không xuất hiện trong Git/log. |
| Tối thiểu hóa dữ liệu | Chỉ lưu nguồn AI mà nhóm đã chọn; recording/audio cần consent, mục đích, retention và quyền xóa rõ. Không dùng dữ liệu Meet để đánh giá con người. |
| An toàn đầu vào | Kiểm tra schema phía máy chủ; làm sạch Markdown/rich text trước khi hiển thị; giới hạn độ dài dữ liệu. |
| Giới hạn tần suất | Áp dụng rate guard cho lời mời, OAuth callback, tạo cuộc họp và thử lại đồng bộ. |
| Lưu trữ giao diện | S3 private REST origin + CloudFront OAC; chỉ dùng HTTPS; không public bucket ngoài CloudFront principal được cho phép. |
| Nhật ký thao tác | Chỉ lưu metadata an toàn; loại trừ OAuth code, token, secret và mật khẩu. |
| Upload và media | Presigned URL thời hạn ngắn; allowlist MIME/đuôi; giới hạn dung lượng; checksum; scan/quarantine; bucket user-content private, mã hóa và có lifecycle riêng. |
| Consent và retention | Lưu phiên bản thông báo consent, người thao tác, thời điểm, nguồn capture và thời hạn lưu; ngừng/xóa theo quyền và chính sách nhóm. |
| Bảo mật AI | Xem file/transcript là dữ liệu không tin cậy; chống prompt injection; không cho nội dung nguồn thay đổi system instruction hoặc tự kích hoạt tool. |
| Cách ly RAG | `groupId`/ACL được kiểm tra trước retrieval và gắn vào metadata vector; có test truy vấn chéo nhóm. |
| Tool use | Tool allowlist, JSON schema chặt, quyền tối thiểu, preview/xác nhận, idempotency và audit. Model không nhận credential và không gọi database trực tiếp. [TL15] |
| Model/provider | Model ID và STT provider là cấu hình theo môi trường; không hard-code `Claude 3`/Deepgram trong nghiệp vụ. Có thể đổi provider sau benchmark mà không đổi contract miền. |

## 11.4 Độ tin cậy

- Dùng idempotency cho các thao tác POST/PUT/DELETE có tác dụng phụ, đặc biệt tạo cuộc họp, Google event và schedule. AWS Lambda khuyến nghị code idempotent vì sự kiện có thể bị gửi lặp. [TL5]

- Dùng conditional write hoặc transactional write của DynamoDB khi cần: chấp nhận lời mời, đổi quyền, chuyển trạng thái công việc và lưu idempotency record.

- Dùng exponential backoff có giới hạn cho lỗi Google/SES có thể thử lại; không lặp vô hạn với lỗi quyền hoặc request không hợp lệ.

- Giao diện phải phân biệt rõ: lịch đã lưu nội bộ, đang chờ đồng bộ Google, đồng bộ thất bại có thể thử lại và lỗi cần người dùng xử lý.

- Reminder Lambda kiểm tra lại trạng thái cuộc họp trước khi gửi thông báo, kể cả khi một schedule cũ vẫn kích hoạt sau khi đã hủy.

- AI pipeline lưu trạng thái bền vững, không chờ Lambda/API đồng bộ; retry chỉ áp dụng cho lỗi retryable, có giới hạn và không tạo trùng transcript/biên bản/tool execution.

- Khi Google artifact, STT, Bedrock hoặc Knowledge Base không khả dụng, dữ liệu cuộc họp lõi vẫn sử dụng được; người dùng có thể nhập biên bản, action item và transcript thủ công.

# 12. Yêu cầu phi chức năng

| Mã | Nhóm | Yêu cầu |
| --- | --- | --- |
| NFR-01 | Độ sẵn sàng và tin cậy | MVP không cam kết SLA production; tuy nhiên thao tác quan trọng phải idempotent, xử lý lỗi an toàn và có thể quan sát. Lịch nhắc không được mất im lặng. |
| NFR-02 | Hiệu năng | Mục tiêu tải trang tĩnh p95 dưới 3 giây trên mạng bình thường; CRUD API nội bộ p95 dưới 1,5 giây với dữ liệu demo. Tích hợp Google là bất đồng bộ, không cam kết thời gian phản hồi đồng bộ. |
| NFR-03 | Bảo mật | Chỉ HTTPS; S3 private/OAC; JWT; secret/token phía máy chủ; least privilege; không hard-code access key. |
| NFR-04 | Quyền riêng tư | Không lưu mật khẩu Google, token ở trình duyệt/log, video/audio/media. Có cơ chế đồng ý và ngắt kết nối Google. |
| NFR-05 | Khả dụng | Thông báo trạng thái dễ hiểu: Đã lưu, Đang tạo liên kết, Cần kết nối lại Google, Đồng bộ thất bại - Thử lại. |
| NFR-06 | Khả năng bảo trì | TypeScript strict, lint/format, cấu trúc module theo miền nghiệp vụ, kiểm tra schema API, README và ghi chú quyết định kỹ thuật. |
| NFR-07 | Khả năng quan sát | Log CloudWatch có cấu trúc; có bằng chứng dashboard/alarm; liên kết `requestId` từ API đến log Lambda. |
| NFR-08 | Chi phí | Tránh compute chạy liên tục và NAT; gắn nhãn tài nguyên; dùng Budget/Cost alert khi tài khoản cho phép; xóa môi trường không phải production. |
| NFR-09 | Khả năng triển khai lại | Môi trường local có thể mô phỏng Google adapter; hạ tầng tái lập bằng một công cụ IaC duy nhất. |
| NFR-10 | Khả năng tiếp cận | Luồng cốt lõi dùng được bằng bàn phím, lỗi hiển thị rõ, có label ngữ nghĩa, độ tương phản phù hợp và giao diện responsive. |
| NFR-11 | Độ chính xác AI | Không cam kết chính xác tuyệt đối. Bộ dữ liệu demo tiếng Việt phải đo transcription/citation và ghi nhận lỗi; transcript có confidence thấp phải được đánh dấu để người dùng kiểm tra. |
| NFR-12 | Grounding | 100% câu trả lời có khẳng định từ nguồn nội bộ phải trả ít nhất một citation hợp lệ hoặc trạng thái không đủ căn cứ; citation mở được đúng nguồn/segment mà người dùng có quyền. |
| NFR-13 | Độ trễ AI | API tạo upload URL/tool proposal p95 dưới 1,5 giây với dữ liệu demo; job file/audio là bất đồng bộ và phải hiển thị progress/status, không đặt SLA hoàn tất cứng phụ thuộc provider. |
| NFR-14 | Chi phí AI | Ghi nhận token, số phút STT và chi phí ước tính theo `AIJob`; có quota theo môi trường/người dùng và cảnh báo khi vượt ngưỡng demo. |
| NFR-15 | Tương thích | Meet Add-on side panel là trải nghiệm cùng tab nhưng không phải điều kiện sử dụng; luồng AI đầy đủ vẫn dùng được trong CampusMeet web nếu add-on chưa cài/bị chặn. Document PiP là progressive enhancement cuối cùng và mất PiP không làm mất dữ liệu. [TL18][TL22][TL24] |
| NFR-16 | Quyền riêng tư media | Recording phải có chỉ báo đang hoạt động, consent và retention; không log nội dung audio/transcript/prompt. Xóa object, index/vector và reference liên quan theo quy trình có thể kiểm chứng. |

# 13. Kiểm thử, giám sát và dọn dẹp tài nguyên

## 13.1 Chiến lược kiểm thử

| Tầng kiểm thử | Mục tiêu | Ví dụ |
| --- | --- | --- |
| Unit test | Kiểm tra logic nghiệp vụ thuần | Tính quá hạn; kiểm tra mốc nhắc; chuyển quyền; ánh xạ trạng thái tích hợp. |
| API / Integration test | Kiểm tra route, quyền và dữ liệu | Thành viên không truy cập nhóm khác; tạo cuộc họp ghi đúng dữ liệu DynamoDB; idempotency trả cùng kết quả. |
| Google adapter test | Kiểm tra payload và ánh xạ lỗi | `requestId` duy nhất, `conferenceDataVersion = 1`, ánh xạ pending/success/failure. |
| End-to-end test | Kiểm tra luồng người dùng | Tạo nhóm → mời thành viên → tạo họp → nhắc lịch → biên bản → công việc → bảng tổng quan. |
| Security test | Kiểm tra quyền âm và an toàn secret | 401/403, token sai, truy cập chéo nhóm, log không chứa token. |
| Operational test | Chứng minh giám sát/cảnh báo | Lỗi có chủ đích tăng metric; CloudWatch Alarm gửi SNS. |
| Cleanup test | Ngăn rò rỉ chi phí | Destroy stack; kiểm tra schedule và S3 object đã xóa/rỗng; xem Cost Explorer. |

## 13.2 Tình huống kiểm thử tối thiểu

| Mã | Khu vực | Tình huống | Kết quả mong đợi |
| --- | --- | --- | --- |
| TC-01 | Nhóm | Quản trị viên tạo nhóm | Nhóm được tạo; người tạo là Quản trị viên nhóm. |
| TC-02 | Thành viên | Chấp nhận lời mời còn hiệu lực | Quyền thành viên hoạt động; lời mời chuyển sang đã chấp nhận. |
| TC-03 | Cuộc họp | Tạo cuộc họp hợp lệ với người tổ chức đã kết nối | Cuộc họp nội bộ được lưu; trạng thái Google có thể quan sát. |
| TC-04 | Google | Calendar tạo event trả về pending | Giao diện hiển thị đang chờ, không có liên kết giả và có cách thử lại. |
| TC-05 | Google | OAuth hết hạn hoặc bị từ chối | Cuộc họp nháp không mất; có hướng dẫn kết nối lại/thử lại. |
| TC-06 | Nhắc lịch | Hủy họp trước giờ nhắc | Không gửi nhắc lịch sau khi hủy. |
| TC-07 | Biên bản/công việc | Chuyển việc cần thực hiện thành công việc | Công việc mang tham chiếu biên bản/cuộc họp nguồn. |
| TC-08 | Phân quyền | Thành viên yêu cầu cuộc họp của nhóm khác | Trả 403; không có dữ liệu nhạy cảm. |
| TC-09 | SES | Người nhận chưa xác minh khi sandbox | Thông báo trong ứng dụng thành công; lỗi email được log/đếm metric. |
| TC-10 | Cảnh báo | Lambda lỗi có chủ đích hoặc custom metric | Có bằng chứng CloudWatch Alarm và SNS. |
| TC-11 | Idempotency | Gửi lại yêu cầu tạo cuộc họp cùng key | Không tạo cuộc họp/event/schedule trùng. |
| TC-12 | Dọn dẹp | Chạy destroy hoặc checklist | Không còn tài nguyên hoạt động ngoài dự kiến. |
| TC-13 | Google artifact | Recording/transcript tồn tại và OAuth đủ quyền | Đồng bộ reference/nội dung đúng meeting; lưu trạng thái `AVAILABLE` và không tạo bản trùng. |
| TC-14 | Google artifact fallback | Gói tài khoản hoặc quyền không cung cấp artifact | Trạng thái `UNAVAILABLE/ACTION_REQUIRED`; dữ liệu nội bộ không mất; có upload/capture fallback. |
| TC-15 | Upload | Upload MIME/kích thước/checksum không hợp lệ | File bị từ chối/quarantine; không tạo ingestion/STT job. |
| TC-16 | Recording consent | Yêu cầu capture khi chưa xác nhận | Không bắt đầu recording; không có object audio; giao diện nêu rõ yêu cầu consent/nguồn capture. |
| TC-17 | STT/diarization | Audio tiếng Việt có nhiều speaker | Tạo segment có timestamp/confidence và speaker label ẩn danh; không tự gán tên thành viên. |
| TC-18 | Transcript edit | Người có quyền sửa text và ánh xạ speaker | Tạo version/audit; citation mới trỏ đúng segment; người không quyền nhận 403. |
| TC-19 | AI grounding | Hỏi câu có và không có bằng chứng | Câu có nguồn trả citation hợp lệ; câu thiếu nguồn trả không xác định, không bịa. |
| TC-20 | RAG authorization | Thành viên nhóm A cố hỏi tài liệu nhóm B | Không retrieve/chuyển đoạn nguồn nhóm B cho model; trả 403 hoặc không có kết quả. |
| TC-21 | Agentic safety | Prompt/tài liệu yêu cầu tự tạo hoặc xóa dữ liệu | Chỉ tạo proposal nếu user có quyền; không mutation trước xác nhận; prompt injection trong file không kích hoạt tool. |
| TC-22 | AI retry/idempotency | Gửi lại transcription/generation/confirm cùng key | Không tạo transcript, minutes draft, task hoặc tool execution trùng. |

## 13.3 Thiết kế giám sát

| Tín hiệu | Nguồn | Metric / truy vấn | Cảnh báo / hành động |
| --- | --- | --- | --- |
| Lỗi API | API Gateway / Lambda | 4xx, 5xx, Errors theo route | 5xx vượt ngưỡng trong 5 phút → SNS. |
| Sức khỏe Lambda | Lambda | Errors, Duration p95, Throttles | Errors vượt ngưỡng → SNS; kiểm tra `requestId`. |
| Đồng bộ Google | API Lambda custom metric | GoogleSyncSuccess, GoogleSyncPending, GoogleSyncFailure | Failure vượt ngưỡng → SNS hoặc tạo issue. |
| Nhắc lịch | Reminder Lambda | ReminderSent, ReminderSkippedCancelled, ReminderEmailFailure | Theo dõi xu hướng lỗi email; kiểm tra SES/sandbox. |
| AI job | Step Functions / AI Worker | AIJobQueued, AIJobCompleted, AIJobFailed, Duration theo loại | Failure/timeout tăng → SNS; tra theo `aiJobId/requestId`, không log prompt/nội dung. |
| STT | Amazon Transcribe/adapter | Phút audio, TranscriptionFailure, segment confidence thấp | Theo dõi quota/chi phí và benchmark tiếng Việt; chuyển fallback thủ công khi lỗi. |
| Bedrock/RAG | Bedrock/Knowledge Base | InvocationError, token usage, RetrievalEmpty, CitationMissing | Cảnh báo chi phí hoặc citation thiếu; kiểm tra ingestion/ACL. |
| Tool use | API/Audit | ProposalCreated, ProposalRejected, ToolExecuted, ToolExecutionDenied | Tăng bất thường → khóa/rate-limit tool; điều tra authorization và prompt injection. |
| Bảo mật | Structured logs / audit | Số 403, tần suất retry bất thường | Tăng đột biến → xem rate guard/quyền. |
| Chi phí | AWS Billing/Budgets nếu cho phép | Chi phí tháng / dự báo | Vượt ngưỡng ngân sách → gửi email. |

> **Ghi chú:** Bằng chứng demo tối thiểu của mỗi thành viên: ảnh chụp hoặc liên kết tới giao diện/endpoint đã triển khai, một kiểm thử thành công, một tình huống lỗi hoặc biên, log CloudWatch, pull request/commit và xác nhận dọn dẹp.

## 13.4 Checklist dọn dẹp

1. Vô hiệu hoặc xóa EventBridge Scheduler schedules và schedule groups do môi trường demo tạo ra.

2. Xóa CloudFormation/CDK/SAM stack theo thứ tự phụ thuộc; xác nhận Lambda, API Gateway, DynamoDB, SNS, Alarm và role do stack quản lý đã được xóa.

3. Làm rỗng và xóa S3 bucket cho static assets/attachment nếu không có chính sách lưu giữ riêng.

4. Tắt và xóa CloudFront distribution khi không còn sử dụng; kiểm tra bucket policy và Origin Access Control.

5. Kiểm tra Cognito User Pool, SES identities và Google OAuth redirect URI; xóa cấu hình chỉ dùng cho demo nếu dừng dự án.

6. Xem Billing/Cost Explorer và tất cả Region đã dùng; ghi lại kết quả không còn tài nguyên hoặc chi phí bất thường.

7. Xóa/expire S3 user-content theo retention, hủy AI jobs còn chạy, xóa Step Functions execution/log, Amazon Transcribe jobs/output, Bedrock Knowledge Base data source và S3 vector index/bucket của môi trường demo khi không cần giữ.

8. Nếu đã đồng bộ Google artifact, thu hồi scope/token khi dừng dự án và xác nhận không còn bản sao recording/transcript ngoài chính sách đã công bố.

# 14. Kế hoạch thực hiện và phân công nhóm

## 14.1 Phân công đề xuất cho 5 thành viên

| Thành viên | Vai trò chính | Phạm vi phụ trách | Bằng chứng đóng góp |
| --- | --- | --- | --- |
| Thành viên 1 | Sản phẩm và giao diện | Đặc tả, wireframe, giao diện đăng nhập, nhóm, lịch họp và bảng tổng quan. | Wireframe, màn hình frontend, kiểm thử giao diện, PR. |
| Thành viên 2 | Giao diện follow-up và AI | Giao diện biên bản, công việc, transcript editor, citation, AI job status, panel/PiP fallback. | Màn hình minutes/task/transcript/AI, kiểm thử accessibility, PR, kịch bản demo. |
| Thành viên 3 | Backend cốt lõi | Lambda API, mô hình DynamoDB, phân quyền, kiểm tra dữ liệu, nhật ký thao tác, AI application service/tool proposal. | API docs, test quyền chéo nhóm/tool confirmation, PR backend. |
| Thành viên 4 | Tích hợp Google và AI grounding | OAuth, Calendar event, Meet artifact adapter, trạng thái chờ/thử lại, prompt/citation/evaluation. | Bằng chứng OAuth/Google adapter, AI evaluation dataset, mock/test lỗi, PR. |
| Thành viên 5 | AWS, AI pipeline và vận hành | SAM, S3/CloudFront/Cognito/API Gateway/Scheduler/SES, Step Functions/Transcribe/Bedrock/Knowledge Base, CloudWatch/SNS, cleanup. | IaC, deploy, AI job/alarm/log/cost, checklist cleanup. |

Tất cả thành viên vẫn cần hiểu luồng chính và cùng review code. Phân công không có nghĩa là mỗi người chỉ làm một phần; mục đích là xác định ownership rõ ràng, tránh trùng việc và có bằng chứng đóng góp cá nhân.

## 14.2 Lộ trình 8 tuần

| Tuần | Trọng tâm | Kết quả | Tiêu chí kết thúc |
| --- | --- | --- | --- |
| Tuần 1 | Khám phá và thống nhất | Đặc tả v1.1, wireframe, mô hình dữ liệu, kiến trúc v1, kế hoạch tài khoản/IAM/chi phí. | Mentor phản hồi hoặc nhóm thống nhất baseline. |
| Tuần 2 | Nền tảng | Repository, CI, skeleton IaC, Cognito, S3 + CloudFront, API skeleton, UI khung. | Có trang triển khai thử và bằng chứng đăng nhập. |
| Tuần 3 | Nhóm và thành viên | Tạo nhóm, lời mời/thành viên, phân quyền, kiểm thử chéo nhóm. | Có kiểm thử 403 khi truy cập nhóm khác. |
| Tuần 4 | Cuộc họp cốt lõi | Tạo/sửa/hủy lịch, agenda, người tham dự, danh sách/lịch, nhật ký bước đầu. | Hoàn thành luồng cuộc họp nội bộ đầu-cuối. |
| Tuần 5 | Tích hợp Google | OAuth, Google Calendar event, conference request, `googleSyncStatus`, thử lại, prototype Meet artifact sync và spike Meet Add-on side panel bằng deployment chưa công bố. | Có bằng chứng tích hợp thật hoặc mock kiểm soát; add-on lấy được meeting context hoặc có quyết định fallback; artifact không có vẫn dùng được. |
| Tuần 6 | Luồng sau họp và dữ liệu AI | Nhắc lịch, biên bản, công việc, dashboard; S3 presigned upload, Attachment/AIJob, consent và recording metadata. | Hoàn thành biên bản → công việc → dashboard; upload không đi qua API payload. |
| Tuần 7 | AI vertical slice và vận hành | Batch STT tiếng Việt, transcript editor, Bedrock hỏi đáp/citation, minutes/action-item draft; SES, CloudWatch/alarm/SNS. | Demo audio/tài liệu → transcript → biên bản/action item → hỏi đáp có nguồn; fallback thủ công hoạt động. |
| Tuần 8 | Đóng băng và trình bày | Test quyền/RAG/tool confirmation, sửa lỗi, workshop song ngữ, video demo, cost/cleanup, thuyết trình. | Đạt điều kiện hoàn thành Core MVP + AI MVP; không mở live/agentic mở rộng nếu luồng dọc chưa ổn định. |

> **Ghi chú:** Cổng kiểm soát phạm vi: AI MVP là một luồng dọc đã chốt, không phải lý do mở mọi tính năng AI. Meet Add-on chỉ làm side panel tối giản và phải dùng lại web/API hiện có; quy trình public Marketplace không được chặn Core MVP. Live transcription, RAG nhiều cuộc họp đầy đủ, tool use nhiều miền, analytics mở rộng và Document PiP chỉ được mở khi Core MVP cùng AI MVP hiện có đã kiểm thử thành công. Video call/chat thời gian thực vẫn ngoài phạm vi.

## 14.3 Pha AI mở rộng sau baseline 8 tuần

| Pha | Phạm vi | Điều kiện vào | Điều kiện ra |
| --- | --- | --- | --- |
| AI-1 | RAG nhiều cuộc họp với Knowledge Bases/S3 Vectors và citation/ACL | AI MVP một meeting ổn định, ingestion có idempotency | Test chéo nhóm không rò dữ liệu; citation mở đúng nguồn. |
| AI-2 | Agenda/form prefill, tool proposal cho meeting/task/group | API nghiệp vụ, authorization và audit đã hoàn chỉnh | Không mutation trước xác nhận; tool replay không tạo trùng. |
| AI-3 | Meet Add-on side panel, Document PiP fallback và live transcription thử nghiệm | Web/API ổn định, add-on deployment thử nghiệm, consent/capture prototype và benchmark STT đạt yêu cầu demo | Add-on ánh xạ đúng meeting và không vượt quyền; mất add-on/PiP/stream không làm mất dữ liệu; người dùng thấy rõ recording state. |
| AI-4 | Google Meet artifact sync nâng cao | Có tài khoản/quyền demo phù hợp và quyết định OAuth verification | Đồng bộ được khi khả dụng, fallback rõ khi không có artifact. |

Nếu mục tiêu là hoàn thiện toàn bộ bốn pha với kiểm thử bảo mật, chi phí và quyền riêng tư, kế hoạch thực tế cần thêm khoảng 4 đến 8 tuần sau baseline, thay vì nhồi toàn bộ vào tuần 7-8.

# 15. Rủi ro và điều kiện hoàn thành MVP

## 15.1 Rủi ro chính

| Rủi ro | Mức ảnh hưởng | Cách xử lý |
| --- | --- | --- |
| Google OAuth/consent cấu hình chậm | Cao | Kiểm thử redirect URI ngay tuần 1; làm phần CRUD nội bộ độc lập; phân một người chịu trách nhiệm tích hợp Google. |
| Liên kết Meet chờ hoặc lỗi bị hiểu là lỗi ứng dụng | Trung bình | Hiển thị rõ trạng thái; có retry giới hạn và nút Thử lại; không tạo liên kết giả. |
| SES sandbox không gửi được email demo | Trung bình | Xác minh email test của nhóm; thông báo trong ứng dụng là bắt buộc; ghi rõ giới hạn sandbox. |
| Phạm vi bị phình | Cao | Khóa MVP theo MoSCoW; không làm tính năng nâng cao trước khi test luồng bắt buộc. |
| Lỗi phân quyền giữa các nhóm | Cao | Tạo hàm kiểm tra quyền trung tâm; có test 403 chéo nhóm và code review. |
| Tạo trùng Calendar event hoặc reminder khi thử lại | Cao | Dùng idempotency key, conditional write và lưu Google event ID. |
| Chi phí AWS bất ngờ | Cao | Không dùng NAT/EC2/RDS; có Budget alert nếu tài khoản hỗ trợ; triển khai/destroy bằng IaC và gắn nhãn tài nguyên. |
| Tài liệu hoặc bằng chứng làm muộn | Trung bình | Cập nhật workshop và ảnh chụp sau mỗi sprint; mỗi thành viên có checklist evidence. |
| Không thu được toàn bộ âm thanh Meet | Cao | Hiển thị rõ nguồn capture; prototype `getDisplayMedia`/micro; ưu tiên Google artifact hoặc upload; không cam kết recording ngầm. |
| STT tiếng Việt/diarization sai | Cao | Benchmark Amazon Transcribe và Deepgram; giữ confidence/timestamp; speaker label ẩn danh; transcript editor và human review. |
| Prompt injection hoặc AI vượt quyền | Cao | Xem nguồn là untrusted; retrieval ACL; tool allowlist/schema; xác nhận; API authorization; audit và test âm. |
| RAG rò dữ liệu nhóm khác | Cao | Filter `groupId`/ACL trước retrieval; metadata vector bắt buộc; test chéo nhóm và xóa vector cùng source. |
| AI hallucination tạo biên bản/task sai | Cao | Citation bắt buộc, trạng thái draft, không đủ nguồn thì từ chối; không ghi chính thức trước khi người có quyền duyệt. |
| Chi phí Bedrock/STT/vector tăng | Trung bình | Ghi token/phút/ước tính chi phí theo job; quota dev; budget alarm; batch và dữ liệu demo nhỏ. |

## 15.2 Điều kiện hoàn thành MVP

1. Mã nguồn chạy được lint, typecheck và build; hạ tầng có thể triển khai lại bằng quy trình IaC đã thống nhất.

2. Hoàn thành luồng: tạo nhóm → thêm thành viên → tạo cuộc họp → trạng thái tích hợp Google → nhắc lịch → biên bản → công việc → bảng tổng quan.

3. Có ít nhất một demo thật hoặc demo kiểm soát cho Calendar event/conference request; nếu Google chưa cấp liên kết do cấu hình ngoài hệ thống, phải trình bày trung thực trạng thái `PENDING/FAILED` và cách xử lý.

4. Hoàn thành kiểm thử quyền chéo nhóm, lỗi Google, an toàn khi hủy/nhắc lịch, lỗi SES và idempotency.

5. Có log CloudWatch, metric, ít nhất một Alarm/SNS và không có secret trong log.

6. Sơ đồ kiến trúc có AWS Cloud/Region đúng, luồng đánh số rõ; tài liệu workshop đáp ứng yêu cầu song ngữ của chương trình.

7. Có checklist dọn dẹp hoặc lệnh IaC destroy đã kiểm tra; có rà soát chi phí sau demo.

8. Mỗi thành viên có pull request/commit, kiểm thử hoặc bằng chứng riêng và worklog mô tả phần việc.

9. AI MVP hoàn thành luồng tài liệu/audio → transcript có timestamp/confidence → chỉnh sửa/ánh xạ speaker → bản nháp biên bản/action item → hỏi đáp có citation; mọi mutation cần xác nhận và không rò dữ liệu chéo nhóm.

10. Có bằng chứng consent/recording indicator, AI job retry/failure, đo chất lượng tiếng Việt trên tập demo, số liệu token/phút/chi phí và cleanup S3/Transcribe/Knowledge Base/vector.

# 16. Phụ lục

## 16.1 Thuật ngữ

| Thuật ngữ | Định nghĩa |
| --- | --- |
| Agenda | Nội dung/chủ đề dự kiến của cuộc họp. |
| Action item | Việc cần thực hiện phát sinh từ quyết định hoặc thảo luận; có thể chuyển thành công việc. |
| Attendee | Người được mời hoặc dự kiến tham dự cuộc họp. |
| Calendar event | Sự kiện tạo trong Google Calendar của người tổ chức; có thể chứa thông tin tham gia Google Meet. |
| Conference data | Dữ liệu hội nghị của Google Calendar event, gồm yêu cầu tạo hội nghị/liên kết khi Google hỗ trợ. |
| Idempotency | Tính chất một thao tác khi gọi lại cùng đầu vào không tạo tác dụng phụ lặp lại. |
| Trạng thái đồng bộ | Trạng thái CampusMeet đồng bộ với Google: `NOT_REQUESTED`, `PENDING`, `READY`, `FAILED_RETRYABLE`, `ACTION_REQUIRED`. |
| OAC | Origin Access Control, cơ chế để CloudFront truy cập S3 origin có kiểm soát. |
| Nhắc lịch | Thông báo được lập trước thời gian cuộc họp. |
| Serverless | Mô hình dùng dịch vụ managed/compute theo yêu cầu, không cần duy trì máy chủ ứng dụng chạy liên tục. |
| Artifact | Dữ liệu sinh từ một Google Meet conference như recording, transcript hoặc participant session; chỉ tồn tại khi tài khoản/cài đặt/cuộc họp thực tế tạo ra. |
| STT | Speech-to-Text, chuyển audio thành transcript; kết quả có sai số và cần được người dùng kiểm tra. |
| Speaker diarization | Phân đoạn audio theo speaker label ẩn danh; không đồng nghĩa nhận diện danh tính người nói. |
| Grounding | Buộc câu trả lời AI dựa trên nguồn được phép truy cập và kèm citation kiểm chứng. |
| RAG | Retrieval-Augmented Generation, truy xuất đoạn nguồn liên quan trước khi model sinh câu trả lời. |
| Tool proposal | Đề xuất hành động có cấu trúc do model tạo; chưa gây mutation cho tới khi backend kiểm tra và người dùng xác nhận. |
| Meet Add-on | Giao diện CampusMeet tối giản được Google Meet tải trong side panel/main stage; dùng chung backend và không thay thế CampusMeet web. |
| Marketplace audience | Phạm vi phân phối add-on: deployment chưa công bố để test, private trong một Workspace organization hoặc public sau review. |
| Document PiP | Cửa sổ nổi chứa HTML cho Chatbot trên trình duyệt hỗ trợ; là progressive enhancement và có fallback về panel trong trang. |
| UTC | Coordinated Universal Time; chuẩn dùng để lưu thời gian nội bộ. |

## 16.2 Checklist vẽ sơ đồ kiến trúc

- Vẽ Người dùng/Browser ở ngoài AWS Cloud; Google OAuth, Google Calendar, Google Meet REST API và Google Meet Add-on host cũng ở ngoài AWS Cloud. Mũi tên add-on phải thể hiện Google Meet tải route HTTPS từ CloudFront rồi route đó gọi cùng API; Deepgram chỉ vẽ như provider tùy chọn nếu benchmark chọn.

- Vẽ AWS Cloud, bên trong là AWS Region. CloudFront thể hiện ở lớp global/edge, không đặt như dịch vụ regional.

- Trong Region: S3 static asset bucket, S3 user-content, Cognito, API Gateway, Lambda API, DynamoDB, EventBridge Scheduler, Reminder Lambda, Step Functions, AI Worker, Amazon Transcribe, Amazon Bedrock, Bedrock Knowledge Bases, S3 Vectors, SES, CloudWatch, SNS và kho secret.

- Không vẽ frontend React như một AWS service độc lập. React build được lưu và phân phối qua S3/CloudFront.

- Người nhận email nằm ngoài AWS Cloud; mũi tên SES đi từ AWS Region ra người nhận.

- Đánh số mũi tên theo 1-26 ở Mục 10.2; có chú thích phân biệt luồng API đồng bộ, job bất đồng bộ, Google artifact và AI retrieval/tool proposal.

- Vẽ upload Browser → S3 trực tiếp bằng presigned URL; không vẽ file/audio lớn đi qua API Gateway hoặc Lambda.

- Vẽ `ToolProposal → kiểm tra quyền → preview → xác nhận → API nghiệp vụ`; không vẽ Bedrock ghi thẳng DynamoDB.

- Vẽ `groupId/ACL filter` trước Knowledge Base retrieval và citation quay lại file/meeting/transcript segment.

- Nếu không dùng VPC, ghi chú: `No VPC in MVP - managed serverless workload; avoid NAT cost`. Không vẽ VPC/Subnet chỉ để trang trí.

- Dùng AWS Architecture Icons chính thức khi vẽ draw.io; không dùng logo sai dịch vụ.

## 16.3 Tài liệu tham khảo

[TL1] Google for Developers. Create events - Google Calendar API. Truy cập ngày 06/07/2026. https://developers.google.com/workspace/calendar/api/guides/create-events

[TL2] Google for Developers. Events resource - Google Calendar API v3. Truy cập ngày 06/07/2026. https://developers.google.com/workspace/calendar/api/v3/reference/events

[TL3] AWS Documentation. Invoke a Lambda function on a schedule - EventBridge Scheduler. Truy cập ngày 06/07/2026. https://docs.aws.amazon.com/lambda/latest/dg/with-eventbridge-scheduler.html

[TL4] AWS Documentation. Get started with a CloudFront standard distribution / OAC with S3 origin. Truy cập ngày 06/07/2026. https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/GettingStarted.SimpleDistribution.html

[TL5] AWS Documentation. Best practices for working with AWS Lambda functions. Truy cập ngày 06/07/2026. https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html

[TL6] AWS Documentation. Amazon Cognito user pools. Truy cập ngày 06/07/2026. https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools.html

[TL7] AWS Documentation. Request production access (moving out of Amazon SES sandbox). Truy cập ngày 06/07/2026. https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html

[TL8] AWS Documentation. AWS Well-Architected Framework. Truy cập ngày 06/07/2026. https://docs.aws.amazon.com/wellarchitected/latest/framework/wellarchitected-framework.html

[TL9] Google for Developers. Google Meet REST API overview. Truy cập ngày 27/07/2026. https://developers.google.com/workspace/meet/api/guides/overview

[TL10] Google for Developers. Work with Google Meet artifacts. Truy cập ngày 27/07/2026. https://developers.google.com/workspace/meet/api/guides/artifacts

[TL11] Google for Developers. Google Meet API usage limits and pricing. Truy cập ngày 27/07/2026. https://developers.google.com/workspace/meet/api/guides/limits

[TL12] Google Meet Help. Use Transcripts with Google Meet. Truy cập ngày 27/07/2026. https://support.google.com/meet/answer/12849897

[TL13] AWS Documentation. Amazon Transcribe supported languages and language-specific features. Truy cập ngày 27/07/2026. https://docs.aws.amazon.com/transcribe/latest/dg/supported-languages.html

[TL14] AWS Documentation. Partitioning speakers with Amazon Transcribe. Truy cập ngày 27/07/2026. https://docs.aws.amazon.com/transcribe/latest/dg/diarization.html

[TL15] AWS Documentation. Use a tool to complete an Amazon Bedrock model response. Truy cập ngày 27/07/2026. https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use.html

[TL16] AWS Documentation. Build a knowledge base with vector stores. Truy cập ngày 27/07/2026. https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-build.html

[TL17] AWS Documentation. Use Amazon S3 Vectors with Amazon Bedrock Knowledge Bases. Truy cập ngày 27/07/2026. https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-setup.html

[TL18] Chrome for Developers. Picture-in-Picture for any Element. Truy cập ngày 27/07/2026. https://developer.chrome.com/docs/web-platform/document-picture-in-picture

[TL19] MDN Web Docs. MediaDevices getDisplayMedia. Truy cập ngày 27/07/2026. https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia

[TL20] Google for Developers. Subscribe to events using the Google Workspace Events API. Truy cập ngày 27/07/2026. https://developers.google.com/workspace/events

[TL21] Google Meet Help. Record a video meeting. Truy cập ngày 27/07/2026. https://support.google.com/meet/answer/9308681

[TL22] Google for Developers. Meet add-ons SDK for Web overview. Truy cập ngày 27/07/2026. https://developers.google.com/workspace/meet/add-ons/guides/overview

[TL23] Google for Developers. Deploy a Meet add-on. Truy cập ngày 27/07/2026. https://developers.google.com/workspace/meet/add-ons/guides/deploy-add-on

[TL24] Google for Developers. Publish apps to the Google Workspace Marketplace. Truy cập ngày 27/07/2026. https://developers.google.com/workspace/marketplace/how-to-publish

[TL25] Google for Developers. App review process and requirements for the Google Workspace Marketplace. Truy cập ngày 27/07/2026. https://developers.google.com/workspace/marketplace/about-app-review

[TL26] Google for Developers. Get meeting info with the Meet Add-ons SDK. Truy cập ngày 27/07/2026. https://developers.google.com/workspace/meet/add-ons/guides/get-meeting-info

## 16.4 Quyết định thiết kế nền tảng

| Mã | Quyết định | Lý do |
| --- | --- | --- |
| ADR-01 | CampusMeet quản lý quy trình, không xây dựng video conference. | Bảo vệ phạm vi 8 tuần và tránh hạ tầng media/TURN. |
| ADR-02 | Dùng Lambda Node.js/TypeScript, không dùng Spring Boot Lambda. | Đồng nhất công nghệ nhóm, package/runtime nhẹ và giảm rủi ro triển khai serverless. |
| ADR-03 | Dùng S3 private REST origin + CloudFront OAC, không dùng S3 website public. | Đúng mô hình bảo mật CloudFront/OAC. [TL4] |
| ADR-04 | Dùng EventBridge Scheduler cho nhắc lịch một lần. | Phù hợp tác vụ lịch serverless, có retry/retention. [TL3] |
| ADR-05 | Xử lý tạo Google Meet như một vòng đời bất đồng bộ. | Conference request của Calendar có thể bất đồng bộ. [TL1] |
| ADR-06 | Không dùng VPC/NAT trong MVP. | Không có phụ thuộc private bắt buộc; giảm chi phí và vận hành. |
| ADR-07 | Thông báo trong ứng dụng là bắt buộc, email SES là bổ sung. | SES sandbox có thể hạn chế gửi email demo. [TL7] |
| ADR-08 | Dùng nhiều bảng DynamoDB cho MVP. | Giảm độ khó, dễ chia việc và triển khai nhanh hơn. |
| ADR-09 | Calendar API là luồng tạo lịch/Meet chính; Meet REST API chỉ đồng bộ artifact khi khả dụng và luôn có fallback. | Giữ trải nghiệm Calendar, tận dụng dữ liệu hậu họp nhưng không phụ thuộc gói/quyền ngoài kiểm soát. [TL9][TL10][TL12][TL21] |
| ADR-10 | Amazon Transcribe `vi-VN` là STT mặc định sau benchmark; Deepgram nằm sau `SpeechToTextProvider`. | Giữ kiến trúc AWS-first nhưng không khóa nhà cung cấp nếu chất lượng tiếng Việt thực tế không đạt. [TL13][TL14] |
| ADR-11 | Recording phải có consent, chỉ báo trạng thái và nguồn capture rõ; không cam kết microphone thu toàn bộ Meet. | Trình duyệt yêu cầu người dùng cấp quyền và chọn nguồn; bảo vệ quyền riêng tư, tránh tuyên bố kỹ thuật sai. [TL19] |
| ADR-12 | STT/diarization tạo speaker label ẩn danh, không nhận diện tên. | Diarization không phải voice identity; người dùng ánh xạ/chỉnh sửa để tránh gán nhầm. |
| ADR-13 | AI output là draft có citation; tool use là proposal cần xác nhận và gọi lại API nghiệp vụ chuẩn. | Ngăn hallucination/vượt quyền, tái sử dụng authorization/idempotency/audit hiện có. [TL15] |
| ADR-14 | RAG nhiều cuộc họp dùng Bedrock Knowledge Bases + S3 Vectors, filter `groupId`/ACL trước retrieval. | Hỗ trợ truy xuất có nguồn với vector store serverless/chi phí phù hợp dữ liệu demo. [TL16][TL17] |
| ADR-15 | CampusMeet vẫn là web app độc lập; Meet Add-on side panel là trải nghiệm ưu tiên khi cần dùng cùng tab, còn panel web và Document PiP là fallback. | Không nhân đôi sản phẩm/backend, không nhúng Meet bằng iframe thông thường và không để khả năng cài add-on chặn luồng chính. [TL18][TL22][TL23] |
| ADR-16 | AI/STT provider và model ID là cấu hình, không hard-code một model/version trong SRS. | Cho phép thay model theo Region, availability, benchmark, chi phí và vòng đời dịch vụ mà không đổi nghiệp vụ. |
| ADR-17 | MVP thử Meet Add-on bằng deployment chưa công bố; private/public Marketplace là quyết định phát hành riêng. | Private chỉ dùng trong cùng Workspace organization; public cần Google/OAuth review và audience không đổi được sau khi publish. [TL24][TL25] |

> **Ghi chú:** Trạng thái nền tảng: Đây là bản tài liệu để nhóm dùng thống nhất phạm vi, triển khai và trao đổi với mentor. Sau khi mentor góp ý, nhóm chỉ cần cập nhật những phần chịu ảnh hưởng: phạm vi, yêu cầu, kiến trúc, kiểm thử và kế hoạch thực hiện.
