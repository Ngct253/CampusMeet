export class NotImplementedError extends Error {
  constructor(message = 'Chức năng chưa được triển khai') {
    super(message);
    this.name = 'NotImplementedError';
  }
}
