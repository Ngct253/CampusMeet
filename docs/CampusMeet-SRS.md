CAMPUSMEET

ĐẶC TẢ YÊU CẦU PHẦN MỀM VÀ PHÂN TÍCH DỰ ÁN

Hệ thống quản lý cuộc họp và công việc nhóm tích hợp Google Meet trên nền tảng AWS Serverless

> **Ghi chú:** Nguyên tắc cốt lõi: CampusMeet không xây dựng hoặc sao chép Google Meet. Hệ thống quản lý quy trình trước - trong - sau cuộc họp; Google Meet chỉ là nền tảng hội nghị được tích hợp qua Google Calendar API.

Tên tiếng Anh: CampusMeet - Meeting and Team Work Management System with Google Meet Integration

# Cách sử dụng tài liệu

- Mục 1 đến Mục 5 giúp cả nhóm thống nhất bài toán, người dùng, phạm vi và các giới hạn triển khai trước khi lập trình.

- Mục 6 đến Mục 9 mô tả các chức năng, ca sử dụng, nhu cầu người dùng, quy tắc nghiệp vụ và dữ liệu.

- Mục 10 đến Mục 13 dùng để thiết kế, triển khai, kiểm thử, giám sát và dọn dẹp tài nguyên AWS.

- Mục 14 đến Mục 16 hỗ trợ phân công, theo dõi tiến độ, quản lý rủi ro và hoàn thiện workshop.

> **Ghi chú:** Quy tắc thay đổi phạm vi: Không bổ sung chức năng lớn như video call riêng, chat thời gian thực, AI tóm tắt transcript hoặc lịch họp định kỳ trước khi toàn bộ chức năng bắt buộc đã được kiểm thử từ đầu đến cuối. Mọi thay đổi phải được nhóm ghi nhận về ảnh hưởng tới dữ liệu, API, chi phí, kiểm thử và tiến độ.

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
| Thiếu bằng chứng vận hành | Đồ án chỉ có giao diện CRUD nên khó thể hiện triển khai cloud đầu-cuối. | Triển khai serverless, có log, chỉ số, cảnh báo, hướng dẫn triển khai và dọn dẹp tài nguyên. |

## 1.3 Cơ sở kỹ thuật

Google Calendar API cho phép yêu cầu tạo dữ liệu hội nghị khi tạo sự kiện, với `conferenceData.createRequest`, `requestId` riêng cho từng sự kiện và `conferenceDataVersion = 1`. Việc tạo liên kết có thể hoàn tất bất đồng bộ, vì vậy CampusMeet cần hiển thị trạng thái rõ ràng thay vì giả định liên kết luôn có ngay. [TL1][TL2]

EventBridge Scheduler phù hợp cho các thông báo nhắc lịch theo thời điểm cụ thể. Với phần giao diện tĩnh, mô hình S3 private REST origin kết hợp CloudFront và Origin Access Control (OAC) giúp phân phối nội dung an toàn hơn so với public S3 website bucket. [TL3][TL4]

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

## 2.3 Tiêu chí thành công của MVP

- Quản trị viên tạo được nhóm, thêm thành viên và lập lịch cuộc họp.

- Cuộc họp được lưu nội bộ; khi Google đã kết nối, hệ thống hiển thị đúng trạng thái đồng bộ và liên kết Meet khi sẵn sàng.

- Thông báo nhắc lịch được tạo đúng thời điểm; thông báo trong hệ thống không phụ thuộc vào việc gửi email có thành công hay không.

- Biên bản sau họp có thể tạo công việc, giao người phụ trách và cập nhật lên bảng tổng quan.

- Nhóm trình bày được log CloudWatch, ít nhất một cảnh báo thử nghiệm, tài liệu triển khai và checklist dọn dẹp.

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
| Nên có | Lời mời qua email/liên kết, đồng bộ khi sửa/hủy lịch, nhật ký thao tác, lịch theo tháng/tuần, demo email bằng SES. | Thực hiện khi các luồng bắt buộc đã ổn định. |
| Có thể có | Lịch định kỳ, đính kèm tệp bằng S3 presigned URL, email tổng hợp hằng ngày, tích hợp Discord/Slack, dữ liệu hậu họp từ Meet API. | Chỉ làm sau tuần 6 và không làm chậm MVP. |
| Không làm trong MVP | Video/audio call riêng, chat thời gian thực, chia sẻ màn hình, WebRTC/TURN, AI tóm tắt transcript, điểm danh tự động. | Loại khỏi phạm vi 8 tuần. |

## 5.2 Giả định

- Mỗi cuộc họp có một người tổ chức là người cấp quyền OAuth để sự kiện được tạo trong Google Calendar của họ.

- Chính sách tài khoản Google/Google Workspace có thể ảnh hưởng tới khả năng tạo hoặc hiển thị dữ liệu hội nghị; hệ thống phải hiển thị trạng thái thay vì cam kết liên kết luôn trả về ngay.

- MVP được minh họa với dữ liệu nhỏ: khoảng 3 đến 5 nhóm, 10 đến 30 thành viên và 20 đến 50 cuộc họp.

- Múi giờ mặc định là Asia/Ho_Chi_Minh; dữ liệu thời gian được lưu theo UTC và quy đổi khi hiển thị.

- Nhóm dùng GitHub, nhánh làm việc, pull request và một công cụ Infrastructure as Code thống nhất: AWS CDK TypeScript hoặc AWS SAM.

## 5.3 Ràng buộc

| Ràng buộc | Hệ quả thiết kế |
| --- | --- |
| 08 tuần / 05 thành viên | Phải ưu tiên các luồng cốt lõi; chức năng nâng cao không được chặn MVP. |
| Mục tiêu serverless và kiểm soát chi phí | Không dùng EC2, NAT Gateway, RDS, ALB, EKS/Kubernetes trong MVP. |
| Tích hợp Google phụ thuộc bên thứ ba | Cần mô phỏng adapter, cơ chế thử lại, trải nghiệm lỗi rõ ràng và kiểm thử OAuth thất bại. |
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
| FR-09 | Bắt buộc | Trạng thái đồng bộ | Lưu `googleEventId`, `integrationStatus` (`PENDING/READY/FAILED`), số lần thử lại và thông báo lỗi an toàn. |
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

## 6.1 Yêu cầu tích hợp Google Calendar / Google Meet

| Mã | Yêu cầu |
| --- | --- |
| INT-01 | Dùng OAuth 2.0 Authorization Code Flow; đăng ký đúng redirect URI cho môi trường local và môi trường triển khai. |
| INT-02 | Máy chủ giữ access token/refresh token; trình duyệt chỉ nhận trạng thái kết nối và dữ liệu cần hiển thị. |
| INT-03 | Mỗi sự kiện dùng `conferenceDataVersion = 1` và `requestId` riêng khi yêu cầu tạo dữ liệu hội nghị. |
| INT-04 | Khi trạng thái còn chờ, hệ thống kiểm tra hoặc thử lại có giới hạn; không tạo event mới chỉ để thử lại một yêu cầu đang chờ. |
| INT-05 | Khi sửa/hủy, hệ thống phân biệt lỗi có thể thử lại và lỗi không thể thử lại; giao diện hiển thị rõ dữ liệu nội bộ đã lưu nhưng đồng bộ Google đang chờ hoặc thất bại. |
| INT-06 | Dữ liệu participants/recording/transcript từ Google Meet chỉ là phần mở rộng sau cuộc họp, chỉ dùng khi quyền và dữ liệu thực tế đáp ứng. |

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

## 9.2 Vòng đời trạng thái

> **Ghi chú:** Vòng đời cuộc họp: `DRAFT` → `SCHEDULED` → `INTEGRATION_PENDING` → `READY` → `COMPLETED`<br>Từ các trạng thái trước khi hoàn thành, cuộc họp có thể chuyển sang `CANCELLED`.<br>Khi đồng bộ Google gặp lỗi có thể thử lại: `INTEGRATION_PENDING` → `FAILED_RETRYABLE` → `READY` hoặc `FAILED_ACTION_REQUIRED`.<br><br>Vòng đời công việc: `TODO` ↔ `DOING` → `DONE`; công việc hoàn thành có thể được mở lại và chuyển về `DOING`.<br>Vòng đời lời mời: `PENDING` → `ACCEPTED \| DECLINED \| EXPIRED \| REVOKED`.<br>Vòng đời nhắc lịch: `SCHEDULED` → `PROCESSING` → `SENT \| FAILED \| CANCELLED`.

## 9.3 Mô hình dữ liệu logic

| Thực thể | Thuộc tính chính | Quan hệ |
| --- | --- | --- |
| Người dùng | `userId`, `cognitoSub`, email, tên hiển thị, múi giờ, tùy chọn thông báo | Có nhiều quyền thành viên và thông báo. |
| Nhóm | `groupId`, tên, mô tả, người tạo, thời điểm tạo | Có nhiều thành viên, cuộc họp, công việc và nhật ký. |
| Quyền thành viên | `groupId`, `userId`, vai trò, trạng thái, thời điểm tham gia | Liên kết giữa người dùng và nhóm; là cơ sở phân quyền. |
| Lời mời | `invitationId`, `groupId`, email, tokenHash, thời hạn, trạng thái | Thuộc nhóm; có thể tạo quyền thành viên sau khi chấp nhận. |
| Cuộc họp | `meetingId`, `groupId`, người tổ chức, tiêu đề, agenda, thời gian, trạng thái, `googleEventId`, `meetUrlRef` | Có người tham dự, nhắc lịch, một biên bản và nhiều công việc. |
| Nhắc lịch | `reminderId`, `meetingId`, mốc nhắc, thời điểm chạy, trạng thái | Thuộc một cuộc họp. |
| Biên bản | `minutesId`, `meetingId`, tóm tắt, thảo luận, quyết định, người tạo | Một biên bản cho một cuộc họp; là nguồn của công việc. |
| Công việc | `taskId`, `groupId`, nguồn cuộc họp/biên bản, tiêu đề, người phụ trách, hạn, ưu tiên, trạng thái | Thuộc nhóm; có thể tham chiếu cuộc họp/biên bản. |
| Thông báo | `notificationId`, `userId`, loại, đối tượng, nội dung, thời điểm đã đọc | Thuộc người dùng. |
| Nhật ký | `auditId`, `groupId`, người thao tác, hành động, đối tượng, thời điểm | Thuộc nhóm; chỉ lưu dữ liệu an toàn. |

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

# 10. Kiến trúc giải pháp AWS và lý do lựa chọn

## 10.1 Kiến trúc đề xuất

CampusMeet sử dụng kiến trúc serverless và dịch vụ managed để giảm vận hành, giảm chi phí cố định và phù hợp thời gian 8 tuần. Sơ đồ kiến trúc chính thức cần vẽ rõ khung AWS Cloud, AWS Region, lớp global/edge và các hệ thống bên ngoài AWS. Không đưa Lambda vào VPC chỉ để có VPC: MVP không có tài nguyên private bắt buộc, trong khi NAT Gateway làm tăng chi phí và độ phức tạp.

> **Ghi chú:** Bên ngoài AWS Cloud: Người dùng/Browser, Google OAuth + Google Calendar API + Google Meet, người nhận email và người phụ trách nhận cảnh báo.<br><br>Lớp global/edge: CloudFront.<br><br>Trong AWS Region: S3 private static assets, Cognito User Pool, API Gateway, Lambda API, DynamoDB, EventBridge Scheduler, Reminder Lambda, SES, CloudWatch, SNS và Secrets Manager hoặc Systems Manager Parameter Store.

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
| AWS CDK hoặc AWS SAM | Triển khai hạ tầng bằng mã, tái lập và dọn dẹp được. | Nhóm chọn duy nhất một công cụ. |

## 10.4 Trình tự tích hợp Google

- Kết nối Google: Trình duyệt → CampusMeet API → Google OAuth consent → callback → API kiểm tra state/PKCE (nếu áp dụng) → lưu token phía máy chủ → trả về trạng thái đã kết nối. Token refresh không được trả về trình duyệt.

- Tạo cuộc họp: Quản trị viên → API lưu cuộc họp nội bộ → API gọi Google Calendar tạo event và `conferenceData.createRequest` → lưu trạng thái `PENDING/READY/FAILED` → tạo/cập nhật lịch nhắc.

- Thử lại đồng bộ: Chỉ kiểm tra event đã biết hoặc thử lại có giới hạn; không tạo event mới một cách mù quáng để tránh trùng event/liên kết.

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

## 11.2 Hợp đồng phản hồi lỗi

Ví dụ phản hồi khi lịch đã lưu nội bộ nhưng Google Meet đang được tạo:

```json
{
  "code": "GOOGLE_SYNC_PENDING",
  "message": "Lịch đã được lưu. Google Meet đang được tạo; hãy thử lại sau.",
  "requestId": "req_01...",
  "details": { "meetingId": "...", "retryAllowed": true }
}
```

| HTTP | Nhóm lỗi | Ví dụ mã | Cách giao diện xử lý |
| --- | --- | --- | --- |
| 400 | Dữ liệu không hợp lệ | `INVALID_MEETING_TIME` | Làm nổi bật trường lỗi; không tự thử lại. |
| 401 | Chưa xác thực | `UNAUTHENTICATED` | Yêu cầu đăng nhập. |
| 403 | Không có quyền | `FORBIDDEN_GROUP_ACCESS` | Không tiết lộ thêm dữ liệu nhạy cảm. |
| 404 | Không tìm thấy | `MEETING_NOT_FOUND` | Hiển thị trạng thái không tìm thấy. |
| 409 | Xung đột | `IDEMPOTENCY_CONFLICT` | Trả kết quả thao tác gốc khi có thể. |
| 424/502 | Lỗi tích hợp | `GOOGLE_SYNC_FAILED_RETRYABLE` | Hiển thị nút thử lại; dữ liệu nội bộ vẫn giữ. |
| 500 | Lỗi nội bộ | `INTERNAL_ERROR` | Hiển thị thông báo chung và lưu `requestId` vào log. |

## 11.3 Bảo mật và quyền riêng tư

| Khu vực kiểm soát | Yêu cầu cơ bản |
| --- | --- |
| Xác thực | Dùng Cognito User Pool; kiểm tra JWT tại API Gateway và kiểm tra danh tính trong logic backend. [TL6] |
| Phân quyền | Bắt buộc kiểm tra quyền thành viên theo nhóm ở mỗi yêu cầu nghiệp vụ; không tin chỉ `groupId` do trình duyệt gửi. |
| Secret và token | Google client secret, access token và refresh token chỉ được lưu phía máy chủ, mã hóa khi lưu và không xuất hiện trong Git/log. |
| Tối thiểu hóa dữ liệu | Chỉ lưu hồ sơ cần thiết, metadata cuộc họp, biên bản và công việc; không thu âm, video hoặc đánh giá người tham dự trong MVP. |
| An toàn đầu vào | Kiểm tra schema phía máy chủ; làm sạch Markdown/rich text trước khi hiển thị; giới hạn độ dài dữ liệu. |
| Giới hạn tần suất | Áp dụng rate guard cho lời mời, OAuth callback, tạo cuộc họp và thử lại đồng bộ. |
| Lưu trữ giao diện | S3 private REST origin + CloudFront OAC; chỉ dùng HTTPS; không public bucket ngoài CloudFront principal được cho phép. |
| Nhật ký thao tác | Chỉ lưu metadata an toàn; loại trừ OAuth code, token, secret và mật khẩu. |

## 11.4 Độ tin cậy

- Dùng idempotency cho các thao tác POST/PUT/DELETE có tác dụng phụ, đặc biệt tạo cuộc họp, Google event và schedule. AWS Lambda khuyến nghị code idempotent vì sự kiện có thể bị gửi lặp. [TL5]

- Dùng conditional write hoặc transactional write của DynamoDB khi cần: chấp nhận lời mời, đổi quyền, chuyển trạng thái công việc và lưu idempotency record.

- Dùng exponential backoff có giới hạn cho lỗi Google/SES có thể thử lại; không lặp vô hạn với lỗi quyền hoặc request không hợp lệ.

- Giao diện phải phân biệt rõ: lịch đã lưu nội bộ, đang chờ đồng bộ Google, đồng bộ thất bại có thể thử lại và lỗi cần người dùng xử lý.

- Reminder Lambda kiểm tra lại trạng thái cuộc họp trước khi gửi thông báo, kể cả khi một schedule cũ vẫn kích hoạt sau khi đã hủy.

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

## 13.3 Thiết kế giám sát

| Tín hiệu | Nguồn | Metric / truy vấn | Cảnh báo / hành động |
| --- | --- | --- | --- |
| Lỗi API | API Gateway / Lambda | 4xx, 5xx, Errors theo route | 5xx vượt ngưỡng trong 5 phút → SNS. |
| Sức khỏe Lambda | Lambda | Errors, Duration p95, Throttles | Errors vượt ngưỡng → SNS; kiểm tra `requestId`. |
| Đồng bộ Google | API Lambda custom metric | GoogleSyncSuccess, GoogleSyncPending, GoogleSyncFailure | Failure vượt ngưỡng → SNS hoặc tạo issue. |
| Nhắc lịch | Reminder Lambda | ReminderSent, ReminderSkippedCancelled, ReminderEmailFailure | Theo dõi xu hướng lỗi email; kiểm tra SES/sandbox. |
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

# 14. Kế hoạch thực hiện và phân công nhóm

## 14.1 Phân công đề xuất cho 5 thành viên

| Thành viên | Vai trò chính | Phạm vi phụ trách | Bằng chứng đóng góp |
| --- | --- | --- | --- |
| Thành viên 1 | Sản phẩm và giao diện | Đặc tả, wireframe, giao diện đăng nhập, nhóm, lịch họp và bảng tổng quan. | Wireframe, màn hình frontend, kiểm thử giao diện, PR. |
| Thành viên 2 | Giao diện follow-up | Giao diện biên bản, công việc, thông báo và trạng thái người dùng. | Màn hình minutes/task/notification, PR, kịch bản demo. |
| Thành viên 3 | Backend cốt lõi | Lambda API, mô hình DynamoDB, phân quyền, kiểm tra dữ liệu, nhật ký thao tác. | API docs, test quyền chéo nhóm, PR backend. |
| Thành viên 4 | Tích hợp Google | OAuth, Calendar event, conference request, trạng thái chờ/thử lại. | Bằng chứng OAuth/Google adapter, mock/test lỗi, PR. |
| Thành viên 5 | AWS và vận hành | CDK/SAM, S3/CloudFront/Cognito/API Gateway/Scheduler/SES, CloudWatch/SNS, cleanup. | IaC, deploy, alarm/log, checklist cleanup. |

Tất cả thành viên vẫn cần hiểu luồng chính và cùng review code. Phân công không có nghĩa là mỗi người chỉ làm một phần; mục đích là xác định ownership rõ ràng, tránh trùng việc và có bằng chứng đóng góp cá nhân.

## 14.2 Lộ trình 8 tuần

| Tuần | Trọng tâm | Kết quả | Tiêu chí kết thúc |
| --- | --- | --- | --- |
| Tuần 1 | Khám phá và thống nhất | Đặc tả v1.1, wireframe, mô hình dữ liệu, kiến trúc v1, kế hoạch tài khoản/IAM/chi phí. | Mentor phản hồi hoặc nhóm thống nhất baseline. |
| Tuần 2 | Nền tảng | Repository, CI, skeleton IaC, Cognito, S3 + CloudFront, API skeleton, UI khung. | Có trang triển khai thử và bằng chứng đăng nhập. |
| Tuần 3 | Nhóm và thành viên | Tạo nhóm, lời mời/thành viên, phân quyền, kiểm thử chéo nhóm. | Có kiểm thử 403 khi truy cập nhóm khác. |
| Tuần 4 | Cuộc họp cốt lõi | Tạo/sửa/hủy lịch, agenda, người tham dự, danh sách/lịch, nhật ký bước đầu. | Hoàn thành luồng cuộc họp nội bộ đầu-cuối. |
| Tuần 5 | Tích hợp Google | OAuth, Google Calendar event, conference request, PENDING/READY/FAILED, thử lại. | Có bằng chứng tích hợp thật hoặc mock kiểm soát. |
| Tuần 6 | Luồng sau họp | Nhắc lịch, biên bản, công việc, bảng tổng quan, thông báo trong ứng dụng. | Hoàn thành biên bản → công việc → bảng tổng quan. |
| Tuần 7 | Gia cố vận hành | SES demo, CloudWatch metric/alarm/SNS, kiểm thử bảo mật/lỗi, hoàn thiện UI. | Có gói bằng chứng vận hành. |
| Tuần 8 | Đóng băng và trình bày | Sửa lỗi, workshop song ngữ, video demo, cleanup, thuyết trình. | Đạt điều kiện hoàn thành MVP. |

> **Ghi chú:** Cổng kiểm soát phạm vi: Sau tuần 5, chỉ làm chức năng Có thể có khi tất cả chức năng Bắt buộc hiện có đã kiểm thử thành công. Không mở video call, chat thời gian thực hoặc AI trong mọi trường hợp.

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

## 15.2 Điều kiện hoàn thành MVP

1. Mã nguồn chạy được lint, typecheck và build; hạ tầng có thể triển khai lại bằng quy trình IaC đã thống nhất.

2. Hoàn thành luồng: tạo nhóm → thêm thành viên → tạo cuộc họp → trạng thái tích hợp Google → nhắc lịch → biên bản → công việc → bảng tổng quan.

3. Có ít nhất một demo thật hoặc demo kiểm soát cho Calendar event/conference request; nếu Google chưa cấp liên kết do cấu hình ngoài hệ thống, phải trình bày trung thực trạng thái `PENDING/FAILED` và cách xử lý.

4. Hoàn thành kiểm thử quyền chéo nhóm, lỗi Google, an toàn khi hủy/nhắc lịch, lỗi SES và idempotency.

5. Có log CloudWatch, metric, ít nhất một Alarm/SNS và không có secret trong log.

6. Sơ đồ kiến trúc có AWS Cloud/Region đúng, luồng đánh số rõ; tài liệu workshop đáp ứng yêu cầu song ngữ của chương trình.

7. Có checklist dọn dẹp hoặc lệnh IaC destroy đã kiểm tra; có rà soát chi phí sau demo.

8. Mỗi thành viên có pull request/commit, kiểm thử hoặc bằng chứng riêng và worklog mô tả phần việc.

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
| Trạng thái đồng bộ | Trạng thái CampusMeet đồng bộ với Google: `PENDING`, `READY`, `FAILED`. |
| OAC | Origin Access Control, cơ chế để CloudFront truy cập S3 origin có kiểm soát. |
| Nhắc lịch | Thông báo được lập trước thời gian cuộc họp. |
| Serverless | Mô hình dùng dịch vụ managed/compute theo yêu cầu, không cần duy trì máy chủ ứng dụng chạy liên tục. |
| UTC | Coordinated Universal Time; chuẩn dùng để lưu thời gian nội bộ. |

## 16.2 Checklist vẽ sơ đồ kiến trúc

- Vẽ Người dùng/Browser ở ngoài AWS Cloud; Google OAuth, Google Calendar và Google Meet cũng ở ngoài AWS Cloud.

- Vẽ AWS Cloud, bên trong là AWS Region. CloudFront thể hiện ở lớp global/edge, không đặt như dịch vụ regional.

- Trong Region: S3 static asset bucket, Cognito, API Gateway, Lambda API, DynamoDB, EventBridge Scheduler, Reminder Lambda, SES, CloudWatch, SNS và kho secret.

- Không vẽ frontend React như một AWS service độc lập. React build được lưu và phân phối qua S3/CloudFront.

- Người nhận email nằm ngoài AWS Cloud; mũi tên SES đi từ AWS Region ra người nhận.

- Đánh số mũi tên theo 1-16 ở Mục 10.2; có chú thích phân biệt luồng đồng bộ và luồng bất đồng bộ.

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

> **Ghi chú:** Trạng thái nền tảng: Đây là bản tài liệu để nhóm dùng thống nhất phạm vi, triển khai và trao đổi với mentor. Sau khi mentor góp ý, nhóm chỉ cần cập nhật những phần chịu ảnh hưởng: phạm vi, yêu cầu, kiến trúc, kiểm thử và kế hoạch thực hiện.
