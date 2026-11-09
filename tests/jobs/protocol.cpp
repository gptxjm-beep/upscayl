#include "../../vendor/upscayl-ncnn/src/session.h"
#include <cassert>
#include <thread>
#include <condition_variable>
#include <queue>
#include <iostream>
int main() {
 auto dir=std::filesystem::temp_directory_path()/ ("jm-protocol-"+std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
 std::filesystem::create_directory(dir); jm::control=dir;
 std::ofstream(dir/"lease")<<"1";
 assert(jm::admit());
 std::ofstream(dir/"pause")<<"1";
 assert(!jm::admit());std::filesystem::remove(dir/"pause");assert(!jm::admit()); // latched
 jm::halted=false;
 std::mutex mutex;std::condition_variable ready;std::queue<int> queue;
 int accepted=0,completed=0;bool finished=false;
 std::thread producer([&]{
   for(int i=0;i<1000;i++) {
     std::unique_lock<std::mutex> lock(mutex);
     ready.wait(lock,[&]{return queue.size()<8;});
     if(!jm::admit()) break;
     queue.push(i);accepted++;ready.notify_all();
   }
   std::lock_guard<std::mutex> lock(mutex);finished=true;ready.notify_all();
 });
 std::thread consumer([&]{
   for(;;) {
     std::unique_lock<std::mutex> lock(mutex);ready.wait(lock,[&]{return finished||!queue.empty();});
     if(queue.empty()&&finished) break;
     queue.pop();completed++;
     if(completed==3) std::ofstream(dir/"pause")<<"1";
     ready.notify_all();
   }
 });
 producer.join();consumer.join();assert(accepted==completed);assert(accepted<1000);
 assert(jm::unhex("e697a5") == "日");
 assert(jm::unhex("invalid").empty());
 jm::halted=false;std::filesystem::remove(dir/"pause");std::filesystem::remove(dir/"lease");assert(!jm::admit());
 std::filesystem::remove_all(dir);std::cout<<"Protocol admission, lease and drain checks passed\n";
}
