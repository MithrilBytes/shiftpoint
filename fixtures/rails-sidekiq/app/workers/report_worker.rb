class ReportWorker
  include Sidekiq::Worker

  sidekiq_options queue: :reports, retry: 3

  def perform(account_id)
    account = Account.find(account_id)
    Report.build_for(account).deliver
  end
end
